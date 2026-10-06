import { deployContract, verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import type { SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { compiledEventPass, deriveIssuerCommitment, derivePassCommitment, PRIVATE_STATE_ID, validatePrivateState, type EventPassContract, type EventPassPrivateState, type EventPassCircuit } from './contract.js';
import { bytes32, equalBytes, publicAddress, publicHex } from './bytes.js';
import { assertNetwork, type EventPassProviders } from './providers.js';
import { OutcomeUnknownError, withReadTimeout, type Attempt, type AttemptJournal } from './journal.js';
import { readPublicState, verifyReceipt, type Network, type PublicReceipt } from './receipts.js';

export interface AuthorizationRequest {
  action: 'join' | 'deploy' | EventPassCircuit;
  network: Network;
  contractAddress?: string;
  eventId: string;
  commitment?: string;
  /** Proof generation sends witness/preimage data to the configured trusted prover. */
  usesPrivateProver: boolean;
  proofDestination?: string;
  persistsMaintenanceKey: boolean;
  persistsPrivateState: boolean;
  paysDust: boolean;
}
/** Hosting application must obtain appropriate owner approval, not silently return true. */
export type Authorize = (request: AuthorizationRequest) => Promise<boolean>;
export interface AdapterOptions {
  network: Network;
  ownerRole: 'issuer' | 'bearer';
  providers: EventPassProviders;
  compiledAssetsBaseUrl: string;
  journal: AttemptJournal;
  authorize: Authorize;
  /** Name/URI of the owner-approved trusted prover receiving witness/preimage material. */
  proofDestination: string;
  /** Explicit owner/account/event scoped ID. */
  privateStateId: string;
  timeoutMs?: number;
  /** Optional fixed event scope used by the browser session factory. */
  expectedEventId?: Uint8Array;
}

/** Serializes operations because SDK private-state providers have mutable contract scope.
 * A timeout revokes the operation's ability to begin balance/submission. An already
 * started external submission cannot be canceled; its outcome remains unknown.
 */
export class EventPassAdapter {
  readonly #options: AdapterOptions;
  readonly #compiled: ReturnType<typeof compiledEventPass>;
  #joined = false;
  #disposed = false;
  #busy = false;
  #inFlight = 0;
  #address?: string;
  #eventId?: Uint8Array;
  #issuerCommitment?: Uint8Array;
  constructor(options: AdapterOptions) {
    if (!['issuer', 'bearer'].includes(options.ownerRole)) throw new Error('Explicit issuer/bearer owner role required');
    if (!options.providers.guardedEffects) throw new Error('Browser providers must expose guarded external effects');
    if (!options.proofDestination.trim()) throw new Error('Identify the trusted private proof destination');
    if (!options.privateStateId.trim() || options.privateStateId === PRIVATE_STATE_ID) {
      throw new Error('Provide an explicit owner/account/event-scoped privateStateId');
    }
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error('Positive operation timeout required');
    this.#options = { ...options, ...(options.expectedEventId ? { expectedEventId: bytes32(options.expectedEventId, 'Expected event ID') } : {}) };
    this.#compiled = compiledEventPass(options.compiledAssetsBaseUrl);
  }
  async #authorize(request: AuthorizationRequest): Promise<void> {
    if (!await this.#options.authorize(request)) throw new Error('Owner approval was not granted');
    assertNetwork(this.#options.network);
    if (this.#disposed) throw new Error('Owner browser session is closed');
  }
  /** Revoke new downstream external effects; an already-started request cannot be canceled. */
  close(): void { this.#disposed = true; }
  #begin(): void {
    if (this.#disposed) throw new Error('Owner browser session is closed');
    if (this.#busy || this.#inFlight) throw new Error('An operation is still running. Do not retry or resubmit.');
    assertNetwork(this.#options.network);
    this.#busy = true;
  }
  async join(options: { contractAddress: string; eventId: Uint8Array; issuerCommitment: Uint8Array; initialPrivateState: EventPassPrivateState }): Promise<void> {
    this.#begin();
    try {
      const address = publicAddress(options.contractAddress);
      const eventId = bytes32(options.eventId, 'Event ID');
      if (this.#options.expectedEventId && !equalBytes(eventId, this.#options.expectedEventId)) throw new Error('Event does not match this owner-scoped browser session');
      const issuerCommitment = bytes32(options.issuerCommitment, 'Issuer commitment');
      const state = validatePrivateState(options.initialPrivateState);
      if (this.#options.ownerRole === 'issuer' && state.bearerSecret || this.#options.ownerRole === 'bearer' && state.issuerSecret) throw new Error('Private state does not match the owner role');
      await this.#authorize({ action: 'join', network: this.#options.network, contractAddress: address, eventId: publicHex(eventId), usesPrivateProver: false, persistsMaintenanceKey: false, persistsPrivateState: true, paysDust: false });
      const snapshot = await withReadTimeout(readPublicState(this.#options.providers.publicDataProvider, address), this.#options.timeoutMs ?? 120_000);
      if (!snapshot || snapshot.eventId !== publicHex(eventId) || snapshot.issuerCommitment !== publicHex(issuerCommitment)) throw new Error('Contract event/issuer identity mismatch');
      if (state.issuerSecret && !equalBytes(deriveIssuerCommitment(eventId, state.issuerSecret), issuerCommitment)) throw new Error('Issuer capability mismatch');
      // Read-only verifier compatibility check; never call SDK's join-time key generator.
      const [currentState, verifierKeys] = await withReadTimeout(Promise.all([
        this.#options.providers.publicDataProvider.queryContractState(address),
        this.#options.providers.zkConfigProvider.getVerifierKeys(['issue', 'redeem', 'revoke']),
      ]), this.#options.timeoutMs ?? 120_000);
      if (!currentState) throw new Error('Expected deployed contract is absent');
      verifyContractState(verifierKeys, currentState);
      if (this.#disposed) throw new Error('Owner browser session is closed');
      this.#options.providers.privateStateProvider.setContractAddress(address);
      await this.#options.providers.privateStateProvider.set(this.#options.privateStateId, state);
      this.#joined = true;
      this.#address = address; this.#eventId = eventId; this.#issuerCommitment = issuerCommitment;
    } finally { this.#busy = false; }
  }
  async deploy(options: { requestId: string; eventId: Uint8Array; issuerSecret: Uint8Array; signingKey: SigningKey }): Promise<PublicReceipt> {
    this.#begin();
    try {
      if (this.#options.ownerRole !== 'issuer') throw new Error('Only an issuer-scoped session may deploy');
      if (this.#joined || this.#address) throw new Error('This session is already bound to a contract; do not deploy again');
      if (!options.signingKey) throw new Error('Owner-controlled existing maintenance signingKey required; no automatic key creation');
      const eventId = bytes32(options.eventId, 'Event ID');
      if (this.#options.expectedEventId && !equalBytes(eventId, this.#options.expectedEventId)) throw new Error('Event does not match this owner-scoped browser session');
      const issuerSecret = bytes32(options.issuerSecret, 'Issuer secret');
      const issuerCommitment = deriveIssuerCommitment(eventId, issuerSecret);
      await this.#authorize({ action: 'deploy', network: this.#options.network, eventId: publicHex(eventId), usesPrivateProver: true, proofDestination: this.#options.proofDestination, persistsMaintenanceKey: true, persistsPrivateState: true, paysDust: true });
      return await this.#run(options.requestId, 'deploy', eventId, issuerCommitment, undefined, async (providers) => {
        const deployed = await deployContract<EventPassContract>(providers, {
          compiledContract: this.#compiled, privateStateId: this.#options.privateStateId,
          initialPrivateState: { issuerSecret }, args: [eventId, issuerSecret], signingKey: options.signingKey,
        });
        this.#joined = true; this.#address = deployed.deployTxData.public.contractAddress;
        this.#eventId = eventId; this.#issuerCommitment = issuerCommitment;
        return { data: deployed.deployTxData.public, address: deployed.deployTxData.public.contractAddress };
      });
    } finally { this.#busy = false; }
  }
  issue(requestId: string, commitment: Uint8Array): Promise<PublicReceipt> { return this.#call(requestId, 'issue', commitment); }
  revoke(requestId: string, commitment: Uint8Array): Promise<PublicReceipt> { return this.#call(requestId, 'revoke', commitment); }
  redeem(requestId: string, commitment: Uint8Array): Promise<PublicReceipt> { return this.#call(requestId, 'redeem', commitment); }
  async #call(requestId: string, action: EventPassCircuit, input: Uint8Array): Promise<PublicReceipt> {
    this.#begin();
    try {
      if (action === 'redeem' ? this.#options.ownerRole !== 'bearer' : this.#options.ownerRole !== 'issuer') throw new Error('Circuit action does not match the owner role');
      if (!this.#joined || !this.#address || !this.#eventId || !this.#issuerCommitment) throw new Error('Join or deploy the expected event first');
      const commitment = bytes32(input, 'Pass commitment');
      const address = this.#address, eventId = this.#eventId, issuerCommitment = this.#issuerCommitment;
      const snapshot = await withReadTimeout(readPublicState(this.#options.providers.publicDataProvider, address, commitment), this.#options.timeoutMs ?? 120_000);
      if (!snapshot || snapshot.eventId !== publicHex(eventId) || snapshot.issuerCommitment !== publicHex(issuerCommitment)) throw new Error('Contract identity check failed');
      if (snapshot.passStatus !== (action === 'issue' ? 'NEVER_ISSUED' : 'ACTIVE')) throw new Error('Pass is not in the required public state; do not replay');
      this.#options.providers.privateStateProvider.setContractAddress(address);
      const state = await this.#options.providers.privateStateProvider.get(this.#options.privateStateId);
      if (!state) throw new Error('Private capability state is absent');
      if (action === 'redeem' && (!state.bearerSecret || !equalBytes(derivePassCommitment(eventId, state.bearerSecret), commitment))) throw new Error('Bearer capability mismatch');
      if (action !== 'redeem' && (!state.issuerSecret || !equalBytes(deriveIssuerCommitment(eventId, state.issuerSecret), issuerCommitment))) throw new Error('Issuer capability mismatch');
      await this.#authorize({ action, network: this.#options.network, contractAddress: address, eventId: publicHex(eventId), commitment: publicHex(commitment), usesPrivateProver: true, proofDestination: this.#options.proofDestination, persistsMaintenanceKey: false, persistsPrivateState: true, paysDust: true });
      return await this.#run(requestId, action, eventId, issuerCommitment, commitment, async (providers) => {
        // Recreate call interfaces using guarded providers; never use the unguarded found.callTx.
        const { createCircuitCallTxInterface } = await import('@midnight-ntwrk/midnight-js-contracts');
        const callTx = createCircuitCallTxInterface<EventPassContract>(providers, this.#compiled, address, this.#options.privateStateId);
        const call = await callTx[action](commitment);
        return { data: call.public, address };
      });
    } finally { this.#busy = false; }
  }
  async #run(requestId: string, action: 'deploy' | EventPassCircuit, eventId: Uint8Array, issuerCommitment: Uint8Array, commitment: Uint8Array | undefined, operation: (providers: EventPassProviders) => Promise<{ data: FinalizedTxData; address: string }>): Promise<PublicReceipt> {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(requestId)) throw new Error('Provide a non-secret unique requestId');
    const journal = this.#options.journal;
    let attempt: Attempt = { requestId, network: this.#options.network, action,
      ...(this.#address ? { contractAddress: this.#address } : {}), eventId: publicHex(eventId), issuerCommitment: publicHex(issuerCommitment),
      ...(commitment ? { commitment: publicHex(commitment) } : {}), state: 'started', expiresAt: Date.now() + (this.#options.timeoutMs ?? 120_000) };
    await journal.create(attempt);
    let active = true;
    const guard = () => {
      assertNetwork(this.#options.network);
      if (this.#disposed || !active || Date.now() >= attempt.expiresAt) throw new OutcomeUnknownError(requestId);
    };
    const base = this.#options.providers;
    const providers: EventPassProviders = { ...base,
      proofProvider: { proveTx: async (...args) => { guard(); const value = await base.guardedEffects.proveTx(args[0], args[1], guard); guard(); return value; } },
      walletProvider: { getCoinPublicKey: () => { guard(); return base.walletProvider.getCoinPublicKey(); },
        getEncryptionPublicKey: () => { guard(); return base.walletProvider.getEncryptionPublicKey(); },
        balanceTx: async (...args) => { guard(); const value = await base.guardedEffects.balanceTx(args[0], guard); guard(); return value; } },
      midnightProvider: { submitTx: async (tx) => {
        guard(); attempt = { ...attempt, state: 'submitting', candidateTxIds: [...tx.identifiers()] }; await journal.update(attempt);
        guard(); const txId = await base.guardedEffects.submitTx(tx, guard);
        attempt = { ...attempt, state: active ? 'submitted' : 'unknown', txId }; await journal.update(attempt);
        return txId;
      } },
    };
    // A watchdog revokes later side effects; it does NOT cancel any external request already underway.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { active = false; attempt = { ...attempt, state: 'unknown' };
        journal.update(attempt).then(() => reject(new OutcomeUnknownError(requestId)), () => reject(new OutcomeUnknownError(requestId)));
      }, Math.max(1, attempt.expiresAt - Date.now()));
    });
    this.#inFlight++;
    const work = (async () => {
      const result = await operation(providers);
      if (attempt.txId && result.data.txId !== attempt.txId && !result.data.identifiers.includes(attempt.txId)) throw new Error('Finalized transaction does not match the submitted identifier');
      attempt = { ...attempt, contractAddress: result.address, txId: attempt.txId ?? result.data.txId };
      await journal.update(attempt);
      const receipt = await verifyReceipt(base.publicDataProvider, result.data, { network: this.#options.network, action, contractAddress: result.address, eventId, issuerCommitment, ...(commitment ? { commitment } : {}) });
      // Even late finalization can be recorded; the gate must inspect the receipt via reconcile.
      attempt = { ...attempt, state: 'verified', receipt }; await journal.update(attempt);
      return receipt;
    })();
    work.then(() => { this.#inFlight--; }, () => { this.#inFlight--; });
    try { return await Promise.race([work, timedOut]); }
    catch {
      active = false;
      if (attempt.state === 'started') attempt = { ...attempt, state: 'failed-before-submit' };
      else if (attempt.state !== 'verified') attempt = { ...attempt, state: 'unknown' };
      try { await journal.update(attempt); } catch { throw new OutcomeUnknownError(requestId); }
      if (attempt.state === 'failed-before-submit') throw new Error('Operation failed before submission; private provider errors are redacted');
      throw new OutcomeUnknownError(requestId);
    } finally { if (timer) clearTimeout(timer); }
  }
  /** Read-only reconciliation; never rebuilds, signs, proves or resubmits. */
  async reconcile(requestId: string, recoveredDeploymentAddress?: string): Promise<PublicReceipt | null> {
    assertNetwork(this.#options.network);
    const attempt = await this.#options.journal.get(requestId);
    if (!attempt || attempt.network !== this.#options.network) throw new Error('Unknown requestId for this network');
    if (attempt.receipt && attempt.state === 'verified') return attempt.receipt;
    const txId = attempt.txId ?? attempt.candidateTxIds?.[0];
    const address = attempt.contractAddress ?? (attempt.action === 'deploy' && recoveredDeploymentAddress ? publicAddress(recoveredDeploymentAddress) : undefined);
    if (!txId || !address) return null;
    const data = await withReadTimeout(this.#options.providers.publicDataProvider.watchForTxData(txId), this.#options.timeoutMs ?? 120_000);
    if (data.txId !== txId && !data.identifiers.includes(txId)) throw new Error('Finalized transaction identifier mismatch');
    const { publicBytes } = await import('./bytes.js');
    const receipt = await withReadTimeout(verifyReceipt(this.#options.providers.publicDataProvider, data, {
      network: attempt.network, action: attempt.action, contractAddress: address,
      eventId: publicBytes(attempt.eventId), issuerCommitment: publicBytes(attempt.issuerCommitment),
      ...(attempt.commitment ? { commitment: publicBytes(attempt.commitment) } : {}),
    }), this.#options.timeoutMs ?? 120_000);
    await this.#options.journal.update({ ...attempt, contractAddress: address, txId, state: 'verified', receipt });
    return receipt;
  }
}

import { ConsentQueue, type ConsentRequest } from './consent';
import { assetsUrl, loadLiveSdk } from './sdk';
import { ownerId, publicAttemptCopy, bytesFromHex, hexFromBytes, gateContextCopy, PUBLIC_GATE_STORAGE_KEY, eventRegistryCopy, PUBLIC_EVENT_STORAGE_KEY, loadPublicAttempts, publicHex32, receiptIsFinal, trustedEvent, type GateContext, type BrowserSession, type Custody, type LiveView, type PublicAttempt, type PublicReceipt, type Role, type Sdk, type TrustedEvent, type WalletApi } from './model';
import { PublicHistory, PublicHistoryError, PublicHistoryCancelledError, mergePublicAttempt, type PublicHistoryLock } from './public-history';
import type { Attempt as SdkAttempt } from '../../browser-integration/dist/journal.js';
import { forgetCustody } from './custody';
export interface GateClient {
  health(): Promise<{ schema: string; policy: string; storage: string; events: Array<{network: string; contractAddress: string; eventId: string; issuerCommitment: string}> }>;
  close(): void;
  readRedemption?(input: { requestId: string }): Promise<{ admit: false; code: string; attempt: { status: string }; receipt?: PublicReceipt }>;
  openRedemption(input: { requestId: string; network: 'preview'; contractAddress: string; eventId: string; issuerCommitment: string; commitment: string }): Promise<{ admit: false; code: string; attempt: { requestId: string; network: string; contractAddress: string; eventId: string; issuerCommitment: string; commitment: string; baselineBlockHash: string; baselineBlockHeight: number; expiresAt: number } }>;
  claimRedemption(input: { requestId: string; txId: string }): Promise<{ admit: boolean; receipt?: PublicReceipt; code?: string; requestId: string }>;
}
export interface ControllerOptions {
  loadSdk?: () => Promise<Sdk>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  requestId?: () => string;
  /** Explicit shared test lock; production defaults exclusively to navigator.locks. null fails closed. */
  publicHistoryLock?: PublicHistoryLock | null;
  assets?: () => string;
}
export class LiveController {
  readonly consent = new ConsentQueue();
  #state: LiveView = { loaded: false, busy: false, connected: false, joined: false, custodyReady: false, attempts: [], message: '', error: '' };
  #listeners = new Set<() => void>();
  #options: ControllerOptions;
  #sdk?: Sdk;
  #session?: BrowserSession;
  #custody?: Custody;
  #generation = 0;
  #working = false;
  #gate?: GateClient;
  #gateAttempt?: GateContext;
  #historyFailed = false;
  #history: PublicHistory;
  constructor(options: ControllerOptions = {}) {
    this.#options = options;
    this.#history = new PublicHistory(options.storage ?? { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, options.publicHistoryLock);
    try { this.#state.attempts = loadPublicAttempts(this.#storage()); const registry = this.#storage().getItem(PUBLIC_EVENT_STORAGE_KEY); if (registry) this.#state.event = eventRegistryCopy(JSON.parse(registry)); const gate = this.#storage().getItem(PUBLIC_GATE_STORAGE_KEY); if (gate) { this.#gateAttempt = gateContextCopy(JSON.parse(gate)); this.#state.gateContext = this.#gateAttempt; } }
    catch { this.#historyFailed = true; this.#state.error = 'Public request history is unreadable. Live actions are locked. Keep site data and recover the original request IDs before continuing.'; }
  }
  ownerControlGuard(): () => boolean { const generation = this.#generation; return () => generation === this.#generation; }
  #storage(): Pick<Storage, 'getItem' | 'setItem'> { return this.#options.storage ?? localStorage; }
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  #set(update: Partial<LiveView>): void { this.#state = { ...this.#state, ...update }; this.#listeners.forEach(listener => listener()); }
  async load(): Promise<void> {
    try { this.#sdk = await (this.#options.loadSdk ?? loadLiveSdk)(); this.#set({ loaded: true }); }
    catch { this.#set({ error: 'Genuine Midnight SDK/artifact loading failed. Live setup is unavailable until the complete build is mounted.' }); }
  }
  wallets(): Array<{ id: string; api: WalletApi }> {
    const injected = (window as Window & { midnight?: Record<string, WalletApi> }).midnight;
    return this.#sdk?.discoverWallets(injected) ?? [];
  }
  sdk(): Sdk { if (!this.#sdk) throw new Error('Load the genuine SDK first'); return this.#sdk; }
  setCustody(custody: Custody): void {
    if (this.#working) throw new Error('Wait for the current operation before switching private custody');
    this.disconnect(); this.#custody = custody;
    if (this.#state.event && this.#state.event.eventId !== custody.eventId) this.#set({ event: undefined, state: undefined });
    this.#set({ custodyReady: true, role: custody.role, error: '', message: 'Private custody unlocked in memory. Wallet is still disconnected.' });
  }
  get custodyScope(): { role: Role; ownerAccountId: string; eventId: string } | undefined {
    const c = this.#custody; return c ? { role: c.role, ownerAccountId: c.ownerAccountId, eventId: c.eventId } : undefined;
  }
  disconnect(): void {
    this.#generation++; this.consent.respond(false); this.#session?.close(); this.#session = undefined;
    forgetCustody(this.#custody); this.#custody = undefined; this.#gate?.close(); this.#gate = undefined;
    this.#set({ connected: false, joined: false, role: undefined, custodyReady: false, credential: undefined, commitment: undefined, chain: undefined, admission: undefined, busy: this.#working, message: 'Locked. Any unresolved request remains recorded; do not resubmit.' });
  }
  async setGate(client: GateClient): Promise<void> {
    await this.#work(async (generation) => {
      const event = this.#state.event; if (!event) { client.close(); throw new Error('Review the trusted public event before connecting the gate service'); }
      try {
        const health = await client.health(); this.#guard(generation);
        if (health.schema !== 'guestlist-gate-health-v1' || health.policy !== 'active-before-redemption-v1' || health.storage !== 'durable-shared' || !health.events.some(e => e.network === 'preview' && e.contractAddress === event.contractAddress && e.eventId === event.eventId && e.issuerCommitment === event.issuerCommitment)) throw new Error('Wrong gate deployment');
        this.#gate?.close(); this.#gate = client; this.#set({ message: 'Authenticated gate service reports durable shared storage, ACTIVE-before-redemption policy and this exact configured Preview event.' });
      } catch { client.close(); throw new Error('Gate health or exact event verification failed. Gate remains disconnected.'); }
    });
  }
  async reviewEvent(eventInput: unknown): Promise<void> {
    await this.#work(async (generation) => {
      const event = trustedEvent(eventInput);
      if (!await this.#review(generation, { requirement: 'storage', title: 'Review this trusted public event?', acceptLabel: 'Trust this exact Preview identity', details: [`Contract: ${event.contractAddress}`, `Event: ${event.eventId}`, `Issuer: ${event.issuerCommitment}`, 'Obtain these public values from the real event organiser, independently of any attendee QR. Gate operations will also verify exact configured onchain identity. No private capability or wallet connection is needed for this gate-only review.'] })) throw new Error('Trusted event review was declined');
      this.#guard(generation); this.#saveEvent(event); this.#gate?.close(); this.#gate = undefined; this.#set({ event, joined: false, state: undefined, message: 'Owner-reviewed public event identity loaded. This is a trust anchor, not a finalized deployment claim.' });
    });
  }
  #saveEvent(event: TrustedEvent): void { this.#storage().setItem(PUBLIC_EVENT_STORAGE_KEY, JSON.stringify(eventRegistryCopy(event))); }
  #saveGate(context: GateContext): void { const copy = gateContextCopy(context); this.#storage().setItem(PUBLIC_GATE_STORAGE_KEY, JSON.stringify(copy)); this.#gateAttempt = copy; this.#set({ gateContext: copy }); }
  async readGate(requestId: string): Promise<void> {
    await this.#work(async (generation) => {
      if (!this.#gate?.readRedemption) throw new Error('Owner-operated gate status recovery is unavailable');
      const result = await this.#gate.readRedemption({ requestId }); this.#guard(generation);
      if (result.admit !== false) throw new Error('Read-only gate status must never grant entry');
      if (this.#gateAttempt?.requestId === requestId && ['claimed','expired'].includes(result.attempt.status)) this.#saveGate({ ...this.#gateAttempt, status: 'closed' });
      this.#set({ admission: { admit: false, requestId, code: result.code }, message: `Gate recovery status: ${result.code}. A status read never grants entry or resubmits a chain transaction.` });
    });
  }
  async connect(wallet: WalletApi, proofDestination: string): Promise<void> {
    await this.#work(async (generation) => {
      const custody = this.#custody; if (!custody) throw new Error('Personally import the role-specific custody file first');
      if (!proofDestination.trim()) throw new Error('Review and identify the owner-local prover configured in Lace');
      const session = await this.sdk().createBrowserSession({
        scope: { network: 'preview', ownerAccountId: custody.ownerAccountId, eventId: custody.eventId, role: custody.role }, initialApi: wallet,
        encryptionKey: custody.encryptionKey, proofDestination, compiledAssetsBaseUrl: (this.#options.assets ?? assetsUrl)(),
        authorizeConnection: request => this.#review(generation, { requirement: 'connection', title: 'Connect this wallet to Preview?', acceptLabel: 'Connect selected wallet', details: [`Selected wallet: ${request.name} (${request.rdns})`, 'Network: Midnight Preview only', 'Wallet permissions may persist in Lace. This is not proof of funding or DUST readiness.'] }),
        authorizeStorage: request => this.#review(generation, { requirement: 'storage', title: 'Open your private role vault?', acceptLabel: 'Open encrypted role vault', details: [`Role: ${request.scope.role} · owner ${request.scope.ownerAccountId}`, `Preview event: ${request.scope.eventId}`, 'Role capabilities and issuer maintenance authority, when supplied, are encrypted in this browser’s IndexedDB. The nonextractable encryption key stays in memory.', 'Keep your private recovery file. Clearing site data may destroy local capabilities or request history. No plaintext fallback is available.'] }),
        authorizeWalletProver: request => this.#review(generation, { requirement: 'walletProver', title: 'Use the Lace-selected private prover?', acceptLabel: 'Approve private prover path', details: [`Owner-reviewed destination: ${request.proofDestination}`, 'Confirm this matches your owner-local compatible prover in Lace. Connector API 4 cannot independently attest that destination.', 'Private witnesses and proof preimages leave this page through the wallet-selected prover. Do not approve an untrusted or guessed public prover.'] }),
        authorizeOperation: request => this.#review(generation, { requirement: request.usesPrivateProver ? 'transaction' : 'storage', title: request.action === 'join' ? 'Join this trusted Preview event?' : `Approve Preview ${request.action}?`, acceptLabel: request.action === 'join' ? 'Verify event and store my capability' : `Prove, sign and submit ${request.action}`, details: [
          `Action: ${request.action} · Midnight Preview`, `Event: ${request.eventId}`,
          ...(request.contractAddress ? [`Contract: ${request.contractAddress}`] : []), ...(request.commitment ? [`Public commitment: ${request.commitment}`] : []),
          ...(request.usesPrivateProver ? [`Private preimages go to: ${request.proofDestination}`, 'Lace balances, signs and submits the transaction using test DUST. No mainnet funds are used. You must review any separate Lace permission/signature request.'] : ['This verifies public identity and circuit keys; no proof or transaction is submitted.']),
          ...(request.persistsMaintenanceKey ? ['Issuer maintenance authority will be encrypted in this issuer vault.'] : []),
          ...(request.persistsPrivateState ? [`Only your ${custody.role} capability is persisted in the matching role vault.`] : []),
          'Final success requires attributed finalized transaction evidence and an independent state read at that finalized block. An interrupted submission is unknown and must be reconciled, never repeated.',
        ] }),
      });
      if (generation !== this.#generation) { session.close(); throw new Error('Setup was cancelled. Private custody is locked.'); }
      this.#session = session; this.#set({ connected: true, role: custody.role, joined: false, message: 'API-4 Preview wallet connected. Check node/indexer and join or deploy before live actions.' });
    });
  }
  async checkConnection(): Promise<void> {
    const session = this.#session; if (!session) return;
    try { await session.checkConnection(); }
    catch { if (session === this.#session) { this.disconnect(); this.#set({ error: 'Wallet disconnected or its account/network/services changed. Session locked; preserve and reconcile pending requests.' }); } }
  }
  async readNetwork(): Promise<void> {
    await this.#work(async (generation) => {
      const session = this.#requireSession(); await session.checkConnection(); this.#guard(generation);
      const config = session.configuration;
      const chain = await this.sdk().readChainStatus({ network: 'preview', nodeRpcUri: config.substrateNodeUri }); this.#guard(generation);
      const provider = this.sdk().createReadOnlyPublicProvider('preview', config.indexerUri, config.indexerWsUri);
      let state;
      if (this.#state.event) {
        state = await this.sdk().readPublicState(provider, this.#state.event.contractAddress); this.#guard(generation);
        if (!state || state.eventId !== this.#state.event.eventId || state.issuerCommitment !== this.#state.event.issuerCommitment) throw new Error('Indexer event identity does not match the trusted manifest');
      }
      this.#set({ chain, ...(state ? { state } : {}), message: state ? 'Node finalized head and independent indexer event state read successfully.' : 'Node finalized head read. Join a trusted event to verify indexer contract state. This does not verify wallet funding or the prover installation.' });
    });
  }
  async join(eventInput: unknown): Promise<void> {
    await this.#work(async (generation) => {
      const event = trustedEvent(eventInput), session = this.#requireSession(), custody = this.#custody!;
      if (custody.eventId !== event.eventId) throw new Error('Event differs from the unlocked custody scope');
      const approved = await this.#review(generation, { requirement: 'storage', title: 'Trust this public deployment identity?', acceptLabel: 'I reviewed this event identity', details: [`Network: Preview · Contract: ${event.contractAddress}`, `Event: ${event.eventId}`, `Issuer commitment: ${event.issuerCommitment}`, 'Use an identity obtained from the event organiser through a trusted channel. Never derive this trust from an attendee credential. The SDK will independently verify onchain event, issuer and verifier-key compatibility.'] });
      if (!approved) throw new Error('Trusted event review was declined');
      await session.adapter.join({ contractAddress: event.contractAddress, eventId: bytesFromHex(event.eventId), issuerCommitment: bytesFromHex(event.issuerCommitment), initialPrivateState: custody.role === 'issuer' ? { issuerSecret: custody.capability } : { bearerSecret: custody.capability } }); this.#guard(generation);
      this.#saveEvent(event); this.#set({ event, joined: true, state: undefined, message: 'Trusted Preview event and circuit compatibility verified. Role capability stored only in its encrypted vault.' });
    });
  }
  async deploy(): Promise<void> {
    await this.#work(async (generation) => {
      const session = this.#requireSession(), custody = this.#custody!;
      if (!this.#state.chain) throw new Error('Review the node finalized-head check before deployment');
      if (this.#state.event) throw new Error('Join the already selected public event; do not redeploy it');
      if (custody.role !== 'issuer' || !custody.maintenanceSigningKey) throw new Error('Deploy requires personally provisioned issuer capability and maintenance authority');
      const attempt = await this.#newAttempt('deploy', generation);
      const receipt = await this.#transaction(attempt, () => session.adapter.deploy({ requestId: attempt.requestId, eventId: bytesFromHex(custody.eventId), issuerSecret: custody.capability, signingKey: custody.maintenanceSigningKey! }), generation, session);
      this.#guard(generation); if (receipt) this.#acceptDeployment(receipt);
    });
  }
  #acceptDeployment(receipt: PublicReceipt): void {
    const event: TrustedEvent = { network: 'preview', contractAddress: receipt.contractAddress, eventId: receipt.eventId, issuerCommitment: receipt.publicState.issuerCommitment, trust: 'finalized-deployment', deploymentReceipt: receipt };
    this.#saveEvent(event); this.#set({ event, joined: true, state: receipt.publicState, message: 'Preview deployment finalized and independently verified. Save the public event manifest for your bearers and gates.' });
  }
  async issue(commitment: string): Promise<void> { await this.#issuerOperation('issue', commitment); }
  async revoke(commitment: string): Promise<void> { await this.#issuerOperation('revoke', commitment); }
  async #issuerOperation(action: 'issue' | 'revoke', value: string): Promise<void> {
    await this.#work(async (generation) => {
      const session = this.#requireJoined(); if (this.#custody?.role !== 'issuer') throw new Error('Issuer custody required; bearer secrets do not belong in this vault');
      const commitment = publicHex32(value, 'Bearer-supplied public commitment'), attempt = await this.#newAttempt(action, generation, commitment);
      await this.#transaction(attempt, () => session.adapter[action](attempt.requestId, bytesFromHex(commitment)), generation, session);
    });
  }
  prepareBearerCommitment(): void {
    try {
      const custody = this.#custody; if (!custody || custody.role !== 'bearer') throw new Error('Unlock only your own bearer role file first');
      const commitment = hexFromBytes(this.sdk().derivePassCommitment(bytesFromHex(custody.eventId), custody.capability));
      this.#set({ commitment, error: '', message: 'Share this public commitment with the issuer. Your bearer capability stays on your device.' });
    } catch (error) { this.#set({ error: this.#localError(error) }); }
  }
  async present(): Promise<void> {
    await this.#work(async (generation) => {
      this.#requireJoined(); const event = this.#state.event!, custody = this.#custody!;
      if (custody.role !== 'bearer') throw new Error('Present requires your own bearer custody, never issuer custody');
      if (!await this.#review(generation, { requirement: 'presentation', title: 'Reveal your private credential locally?', acceptLabel: 'Show my private QR on this device', details: ['This QR/text contains your bearer capability. Anyone who copies it may redeem first.', 'The credential is generated and rendered locally. It is never placed in a URL, log, issuer vault, external QR service or public receipt.', 'Keep the display private. Copying is a separate explicit owner action.'] })) throw new Error('Private presentation was declined');
      const commitment = this.sdk().derivePassCommitment(bytesFromHex(custody.eventId), custody.capability);
      const config = this.#requireSession().configuration;
      const provider = this.sdk().createReadOnlyPublicProvider('preview', config.indexerUri, config.indexerWsUri);
      const snapshot = await this.sdk().readPublicState(provider, event.contractAddress, commitment); this.#guard(generation);
      if (!snapshot || snapshot.eventId !== event.eventId || snapshot.issuerCommitment !== event.issuerCommitment || snapshot.passStatus !== 'ACTIVE') throw new Error('Bearer pass is not independently ACTIVE for this event. No private QR is shown.');
      const credential = this.sdk().encodeLiveCredential({ ...event, bearerSecret: custody.capability });
      // Round-trip the actual SDK codec against the separately trusted event identity.
      const decoded = this.sdk().decodeLiveCredential(credential, event);
      decoded.bearerSecret.fill(0);
      this.#set({ credential, message: 'Private credential visible only in this unlocked bearer view.' });
    });
  }
  async openGate(commitment: string): Promise<void> {
    await this.#work(async (generation) => {
      if (this.#historyFailed) throw new Error('Unreadable public request history locks new gate operations');
      this.#set({ admission: undefined });
      const event = this.#state.event; if (!event || !this.#gate) throw new Error('Attach the owner-operated durable gate service and trusted event first');
      if (this.#gateAttempt && this.#gateAttempt.status !== 'closed') throw new Error('An admission attempt is already open; preserve its request ID');
      const id = this.#options.requestId?.() ?? crypto.randomUUID();
      const checked = publicHex32(commitment, 'Commitment');
      const pending: GateContext = { requestId: id, network: 'preview', contractAddress: event.contractAddress, eventId: event.eventId, issuerCommitment: event.issuerCommitment, commitment: checked, status: 'opening' };
      this.#saveGate(pending);
      let opened;
      try { opened = await this.#gate.openRedemption(pending); }
      catch { this.#saveGate({ ...pending, status: 'unknown' }); throw new Error('Gate opening outcome unresolved. Keep this public request ID and read gate status; do not open another attempt.'); }
      if (generation !== this.#generation) { this.#saveGate({ ...pending, status: 'unknown' }); this.#guard(generation); }
      const a = opened.attempt;
      if (opened.admit !== false || opened.code !== 'opened' || a.requestId !== id || a.network !== 'preview' || a.contractAddress !== event.contractAddress || a.eventId !== event.eventId || a.issuerCommitment !== event.issuerCommitment || a.commitment !== checked) { this.#saveGate({ ...pending, status: 'unknown' }); throw new Error('Gate opening identity mismatch'); }
      this.#saveGate({ ...pending, status: 'open', baselineBlockHash: a.baselineBlockHash, baselineBlockHeight: a.baselineBlockHeight, expiresAt: a.expiresAt });
      this.#set({ admission: { admit: false, requestId: id, code: 'opened-awaiting-bearer' }, message: 'Gate independently observed ACTIVE and opened this public request. Bearer must redeem after this baseline; no entry is granted yet.' });
    });
  }
  async redeem(gateRequestId: string, commitment: string): Promise<void> {
    await this.#work(async (generation) => {
      const session = this.#requireJoined(), custody = this.#custody!;
      if (custody.role !== 'bearer') throw new Error('Only the bearer device can prove redemption. Never give bearer material to the gate service.');
      const own = hexFromBytes(this.sdk().derivePassCommitment(bytesFromHex(custody.eventId), custody.capability));
      if (publicHex32(commitment, 'Commitment') !== own) throw new Error('Commitment does not match your bearer capability');
      if (!/^[A-Za-z0-9_-]{8,96}$/.test(gateRequestId)) throw new Error('Use the public request ID opened by your gate before redemption');
      if (!await this.#review(generation, { requirement: 'transaction', title: 'Confirm the gate opened this attempt first', acceptLabel: 'This request came from my active gate', details: [`Public gate request ID: ${gateRequestId}`, `Public commitment: ${own}`, 'Confirm your actual gate observed finalized ACTIVE and opened this request before you redeem. Redemption without this prior gate baseline cannot be admitted.', 'Your device retains the bearer capability. Only public request and transaction IDs go to the gate. Finalized redemption still requires the gate’s independent claim-once decision.'] })) throw new Error('Gate baseline confirmation was declined');
      const attempt = await this.#newAttempt('redeem', generation, own, gateRequestId);
      await this.#transaction(attempt, () => session.adapter.redeem(attempt.requestId, bytesFromHex(own)), generation, session);
      this.#set({ credential: undefined });
    });
  }
  async claimGate(requestId: string, txId: string): Promise<void> {
    await this.#work(async (generation) => {
      if (this.#historyFailed) throw new Error('Unreadable public request history locks new gate operations');
      this.#set({ admission: undefined });
      if (!this.#gate) throw new Error('Owner-operated durable gate service required');
      if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestId) || !txId || txId.length > 512 || /\s/.test(txId)) throw new Error('A public gate request ID and real transaction ID are required');
      const context = this.#gateAttempt;
      if (!context || context.requestId !== requestId || !this.#state.event || context.contractAddress !== this.#state.event.contractAddress || context.eventId !== this.#state.event.eventId || context.issuerCommitment !== this.#state.event.issuerCommitment) throw new Error('Use the preserved gate request context for this trusted event');
      if (context.txId && context.txId !== txId) throw new Error('This gate request is already bound to another transaction');
      this.#saveGate({ ...context, status: 'claiming', txId });
      let result;
      try { result = await this.#gate.claimRedemption({ requestId, txId }); }
      catch { this.#saveGate({ ...context, status: 'unknown', txId }); throw new Error('Gate claim outcome unresolved. Read the existing gate request status; no new redemption or entry is authorized.'); }
      if (generation !== this.#generation) { this.#saveGate({ ...context, status: 'unknown', txId }); this.#guard(generation); }
      const receipt = result.receipt;
      const attempt: PublicAttempt = { requestId, action: 'redeem', ownerAccountId: 'gate', eventId: context.eventId, role: 'bearer', commitment: context.commitment, status: 'pending' };
      if (result.requestId !== requestId || !receipt || !receiptIsFinal(receipt, attempt, this.#state.event) || receipt.publicState.passStatus !== 'USED' || !receipt.identifiers.includes(txId) && receipt.txId !== txId || typeof result.admit !== 'boolean' || (result.admit === true ? result.code !== 'admitted' : result.code !== 'already-claimed')) { this.#saveGate({ ...context, status: 'unknown', txId }); throw new Error('Gate result identity mismatch. Entry remains closed.'); }
      this.#saveGate({ ...context, status: 'closed', txId });
      this.#set({ admission: { admit: result.admit === true, requestId: result.requestId, code: result.code }, message: result.admit === true ? 'Admitted once by the durable gate after independent attributed finalization and pinned state verification.' : 'Entry remains closed. Gate rejected, already claimed, or awaiting verified finalization.' });

    });
  }
  async reconcile(requestId: string, recoveredAddress?: string): Promise<void> {
    await this.#work(async (generation) => {
      const session = this.#requireSession();
      ownerId(requestId);
      await this.#refreshAttempts(); this.#guard(generation);
      let attempt = this.#state.attempts.find(row => row.requestId === requestId);
      if (attempt) this.#assertPublicScope(attempt, session);
      // A read error is never evidence that a submission is absent or failed.
      const durable = await session.readAttempt(requestId); this.#guard(generation);
      if (!durable) {
        if (attempt) await this.#replaceAttempt({ ...attempt, status: 'unknown' }); this.#guard(generation);
        this.#set({ message: 'No matching SDK journal row was found in this unlocked scope. This does not establish failure or permission to resubmit. Keep the request ID for read-only recovery.' });
        return;
      }
      const recovered = this.#publicFromSdkAttempt(durable, requestId, session);
      // Merge atomically even when a stale tab or prior cache loss removed the UI row.
      await this.#replaceAttempt(recovered, generation); this.#guard(generation);
      attempt = this.#state.attempts.find(row => row.requestId === requestId)!;
      if (durable.state === 'failed-before-submit') {
        this.#set({ message: 'SDK journal confirms failure before submission. This request is closed without a new success claim.' }); return;
      }
      const receipt = await session.reconcile(requestId, recoveredAddress || undefined); this.#guard(generation);
      if (!receipt) {
        await this.#replaceAttempt({ ...attempt, status: 'unknown' }); this.#guard(generation);
        this.#set({ message: 'Still unresolved. Keep the same request ID, do not resubmit, and do not admit.' }); return;
      }
      await this.#finish(attempt, receipt, generation); this.#guard(generation);
      if (receipt.action === 'deploy') { this.#acceptDeployment(receipt); this.#set({ joined: false, message: 'Deployment independently reconciled. Join the recorded public identity before issuing; do not deploy again.' }); }
    });
  }
  #assertPublicScope(attempt: PublicAttempt, session: BrowserSession): void {
    const custody = this.#custody;
    if (!custody || session.scope.network !== 'preview' || session.scope.ownerAccountId !== custody.ownerAccountId || session.scope.eventId !== custody.eventId || session.scope.role !== custody.role ||
      attempt.ownerAccountId !== session.scope.ownerAccountId || attempt.eventId !== session.scope.eventId || attempt.role !== session.scope.role ||
      (attempt.action === 'redeem' ? attempt.role !== 'bearer' : attempt.role !== 'issuer')) throw new Error('Unlock the original exact owner/event/role to reconcile this request');
  }
  #publicFromSdkAttempt(durable: SdkAttempt, requestId: string, session: BrowserSession): PublicAttempt {
    const allowed = ['requestId','network','action','contractAddress','eventId','issuerCommitment','commitment','state','expiresAt','candidateTxIds','txId','receipt'];
    if (!durable || typeof durable !== 'object' || Object.keys(durable).some(key => !allowed.includes(key)) || durable.requestId !== requestId || durable.network !== 'preview' || durable.eventId !== session.scope.eventId ||
      !['deploy','issue','revoke','redeem'].includes(durable.action) || !['started','submitting','submitted','unknown','verified','failed-before-submit'].includes(durable.state) || !Number.isFinite(durable.expiresAt)) throw new Error('Public SDK attempt does not match the exact unlocked scope; recovery rejected');
    publicHex32(durable.issuerCommitment, 'SDK issuer commitment');
    if (durable.contractAddress) publicHex32(durable.contractAddress, 'SDK contract address');
    const transactionId = (value: unknown) => typeof value === 'string' && /^(?:[a-f0-9]{64}|[a-f0-9]{66})$/.test(value) && !/^0+$/.test(value);
    if (durable.txId !== undefined && !transactionId(durable.txId) || durable.candidateTxIds !== undefined && (!Array.isArray(durable.candidateTxIds) || durable.candidateTxIds.length > 256 || durable.candidateTxIds.some(id => !transactionId(id)))) throw new Error('Public SDK transaction identity is invalid; recovery rejected');
    if (durable.action === 'deploy' ? durable.commitment !== undefined : durable.commitment === undefined || durable.contractAddress === undefined) throw new Error('Public SDK action/commitment identity is invalid; recovery rejected');
    const event = this.#state.event;
    if (event && (event.eventId !== durable.eventId || event.issuerCommitment !== durable.issuerCommitment || durable.contractAddress !== undefined && event.contractAddress !== durable.contractAddress)) throw new Error('Public SDK event/issuer/contract differs from the trusted event; recovery rejected');
    const attempt: PublicAttempt = { requestId, action: durable.action, ownerAccountId: session.scope.ownerAccountId, eventId: durable.eventId, role: session.scope.role,
      status: durable.state === 'verified' ? 'verified' : durable.state === 'failed-before-submit' ? 'rejected' : 'unknown', ...(durable.commitment ? { commitment: publicHex32(durable.commitment, 'SDK commitment') } : {}), ...(durable.receipt ? { receipt: durable.receipt } : {}) };
    this.#assertPublicScope(attempt, session);
    if (durable.receipt && (durable.state !== 'verified' || !receiptIsFinal(durable.receipt, attempt, event) || durable.receipt.publicState.issuerCommitment !== durable.issuerCommitment || durable.contractAddress !== durable.receipt.contractAddress || !durable.txId || durable.receipt.txId !== durable.txId && !durable.receipt.identifiers.includes(durable.txId))) throw new Error('Public SDK receipt does not match its attributed attempt; recovery rejected');
    return publicAttemptCopy(attempt);
  }
  #noteHistoryFailure(error: unknown): void { if (!(error instanceof PublicHistoryError) || error.marksHistoryUnusable) this.#historyFailed = true; }
  async #refreshAttempts(): Promise<void> {
    try { this.#set({ attempts: await this.#history.read() }); }
    catch (error) { this.#noteHistoryFailure(error); throw error; }
  }
  async #newAttempt(action: PublicAttempt['action'], generation: number, commitment?: string, requestId?: string): Promise<PublicAttempt> {
    const custody = this.#custody!;
    if (this.#historyFailed) throw new Error('Unreadable request history locks submissions');
    const attempt: PublicAttempt = { requestId: requestId ?? this.#options.requestId?.() ?? crypto.randomUUID(), action, ownerAccountId: custody.ownerAccountId, eventId: custody.eventId, role: custody.role, status: 'pending', ...(commitment ? { commitment } : {}) };
    try {
      // The active-session check, current rows, collision/unresolved check and write occur under one origin lock.
      const attempts = await this.#history.reserve(attempt, () => this.#guardHistoryGeneration(generation));
      this.#set({ attempts });
      if (generation !== this.#generation) await this.#replaceAttempt({ ...attempt, status: 'unknown' }, generation, true);
      this.#guard(generation); return attempt;
    } catch (error) { if (generation === this.#generation) this.#noteHistoryFailure(error); throw error; }
  }
  async #replaceAttempt(attempt: PublicAttempt, generation?: number, allowInactiveWrite = false): Promise<void> {
    try {
      const rows = await this.#history.merge([attempt], generation === undefined || allowInactiveWrite ? undefined : () => this.#guardHistoryGeneration(generation));
      if (generation !== undefined && generation !== this.#generation) {
        // Global verified evidence must stay monotonic; a locked view still waits for explicit read-only recovery.
        if (attempt.status === 'unknown') this.#cacheUnknown(attempt);
        return;
      }
      this.#set({ attempts: rows });
    }
    catch (error) {
      this.#noteHistoryFailure(error);
      if (attempt.status === 'unknown') {
        this.#cacheUnknown(attempt);
      }
      throw error;
    }
  }
  #cacheUnknown(attempt: PublicAttempt): void {
    const cached = this.#state.attempts.find(row => row.requestId === attempt.requestId);
    const row = cached ? mergePublicAttempt(cached, attempt) : publicAttemptCopy(attempt);
    this.#set({ attempts: this.#state.attempts.filter(item => item.requestId !== row.requestId).concat(row) });
  }
  async #transaction(attempt: PublicAttempt, operation: () => Promise<PublicReceipt>, generation: number, session: BrowserSession): Promise<PublicReceipt | undefined> {
    let invoked = false, receivedReceipt = false;
    try { this.#guard(generation); invoked = true; const receipt = await operation(); receivedReceipt = true; this.#guard(generation); await this.#finish(attempt, receipt, generation); return receipt; }
    catch {
      let status: PublicAttempt['status'] = invoked ? 'unknown' : 'rejected';
      if (invoked) {
        try {
          const durable = await session.readAttempt(attempt.requestId);
          if (!receivedReceipt && generation === this.#generation && (durable === null || durable?.state === 'failed-before-submit')) status = 'rejected';
        } catch { /* Read failure or closed scope means unresolved, never absent. */ }
      }
      await this.#replaceAttempt({ ...attempt, status }, generation, true);
      if (generation === this.#generation) this.#set({ error: status === 'unknown' ? 'Outcome unresolved. Preserve this request ID. Reconcile read-only; do not resubmit or admit.' : 'Operation rejected or failed before submission. No pass success or admission was recorded.' });
      return undefined;
    }
  }
  async #finish(attempt: PublicAttempt, receipt: PublicReceipt, generation: number): Promise<void> {
    if (!receiptIsFinal(receipt, attempt, this.#state.event)) throw new Error('Final receipt does not match this scoped operation. Do not admit.');
    await this.#replaceAttempt({ ...attempt, status: 'verified', receipt }, generation); this.#guard(generation);
    this.#set({ state: receipt.publicState, error: '', message: `${receipt.action} finalized and independently verified at block ${receipt.blockHeight}. This receipt alone does not grant gate admission.` });
  }
  #requireSession(): BrowserSession { if (!this.#session || !this.#custody) throw new Error('Unlock role custody and explicitly connect the Preview wallet first'); return this.#session; }
  #requireJoined(): BrowserSession { const session = this.#requireSession(); if (!this.#state.joined || !this.#state.event) throw new Error('Join or deploy a verified Preview event first'); if (!this.#state.chain) throw new Error('Review the node finalized-head check before live operations'); return session; }
  #localError(error: unknown): string { return error instanceof Error ? error.message : 'Local setup failed'; }
  #guardHistoryGeneration(generation: number): void { if (generation !== this.#generation) throw new PublicHistoryCancelledError(); }
  #guard(generation: number): void { if (generation !== this.#generation) throw new Error('Setup was cancelled. Private custody is locked.'); }
  async #review(generation: number, request: ConsentRequest): Promise<boolean> {
    if (generation !== this.#generation) return false;
    const accepted = await this.consent.request(request);
    return generation === this.#generation && accepted;
  }
  async #work(operation: (generation: number) => Promise<void>): Promise<void> {
    if (this.#working) { this.#set({ error: 'An operation is already running. Keep its request ID and wait; do not repeat it.' }); return; }
    const generation = this.#generation;
    this.#working = true; this.#set({ busy: true, error: '' });
    try { await operation(generation); }
    catch (error) {
      // Do not echo arbitrary wallet/prover/server errors: they can contain private preimages.
      const local = error instanceof Error && /^(Personally|Review|Load|Preview|Connect|Unlock|Deploy requires|Event differs|Trusted event review|Issuer custody|Bearer|Public|Commitment|Use the public|Only the bearer|Owner-operated|A public|Attach|An admission|This owner|This request|Unreadable|Join or deploy|Setup was cancelled)/.test(error.message);
      if (generation === this.#generation) this.#set({ error: local ? error.message : 'Live operation did not complete. Check owner approval, wallet identity, trusted event, services and custody. Preserve unresolved request IDs; no success is inferred.' });
    } finally { this.#working = false; this.#set({ busy: false }); }
  }
}

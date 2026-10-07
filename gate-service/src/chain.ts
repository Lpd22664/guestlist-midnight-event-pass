import { createReadOnlyPublicProvider, assertNetwork } from '../../browser-integration/dist/providers.js';
import { readPublicState, verifyReceipt, type PublicReceipt } from '../../browser-integration/dist/receipts.js';
import { publicBytes } from '../../browser-integration/dist/bytes.js';
import type { GateEvent, GateReceipt, OpenRedemptionRequest } from './types.js';
import { GateError } from './types.js';
import { blockHash, publicHex, transactionId, eventKey } from './validation.js';
import { ReadOnlyAsOfIndexer, localPinnedStateVerifier, type AsOfStateReader } from './as-of-state.js';

export interface FinalizedBaseline { hash: string; height: number }
export interface GateChainReader {
  readActiveBaseline(request: OpenRedemptionRequest): Promise<FinalizedBaseline>;
  verifyRedemption(attempt: OpenRedemptionRequest & { baselineBlockHeight: number }, txId: string): Promise<GateReceipt>;
}
export interface CanonicalFinalityReader {
  finalizedHead(): Promise<FinalizedBaseline>;
  assertFinalizedCanonical(hash: string, height: number): Promise<void>;
}
export interface PublicChainConfiguration extends GateEvent {
  nodeRpcUri: string; indexerUri: string; indexerWsUri: string;
}
/** Node RPC accepts public identifiers only. No account, wallet, prover or transaction submission. */
export class ReadOnlyNode {
  #url: URL;
  #id = 0;
  constructor(uri: string, readonly timeoutMs = 15_000, readonly fetchImpl: typeof fetch = fetch) {
    this.#url = publicServiceUrl(uri, ['http:', 'https:']);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid bounded node timeout');
  }
  async rpc(method: 'chain_getFinalizedHead' | 'chain_getHeader' | 'chain_getBlockHash', params: (string | number)[] = []): Promise<unknown> {
    if (!['chain_getFinalizedHead', 'chain_getHeader', 'chain_getBlockHash'].includes(method) ||
        method === 'chain_getFinalizedHead' && params.length !== 0 ||
        method === 'chain_getHeader' && (params.length !== 1 || typeof params[0] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(params[0])) ||
        method === 'chain_getBlockHash' && (params.length !== 1 || !Number.isSafeInteger(params[0]) || Number(params[0]) < 0)) throw new GateError('verification-failed', 503);
    const id = ++this.#id;
    const response = await this.fetchImpl(this.#url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error', credentials: 'omit' });
    if (!response.ok) throw new GateError('verification-failed', 503);
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('jsonrpc' in value) || value.jsonrpc !== '2.0' || !('result' in value) || 'error' in value) throw new GateError('verification-failed', 503);
    return value.result;
  }
  async finalizedHead(): Promise<FinalizedBaseline> {
    const hash = blockHash(await this.rpc('chain_getFinalizedHead'));
    const header = await this.rpc('chain_getHeader', [`0x${hash}`]);
    if (!header || typeof header !== 'object' || !('number' in header) || typeof header.number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(header.number)) throw new GateError('verification-failed', 503);
    const height = Number.parseInt(header.number.slice(2), 16);
    if (!Number.isSafeInteger(height) || height < 0) throw new GateError('verification-failed', 503);
    return { hash, height };
  }
  async assertFinalizedCanonical(hash: string, height: number): Promise<void> {
    const head = await this.finalizedHead();
    if (!Number.isSafeInteger(height) || height < 0 || height > head.height || blockHash(await this.rpc('chain_getBlockHash', [height])) !== blockHash(hash)) throw new GateError('verification-failed', 503);
  }
}
export function publicServiceUrl(value: string, protocols: string[]): URL {
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Public unauthenticated chain service URL required');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'ws:'].includes(url.protocol)) throw new Error('Remote public services require TLS');
  return url;
}
/** Uses exactly the existing pinned SDK's typed transcript/state verifier, server-owned endpoints. */
export function createMidnightChainReader(configuration: PublicChainConfiguration): GateChainReader {
  publicServiceUrl(configuration.indexerUri, ['http:', 'https:']);
  publicServiceUrl(configuration.indexerWsUri, ['ws:', 'wss:']);
  const node = new ReadOnlyNode(configuration.nodeRpcUri);
  const provider = createReadOnlyPublicProvider(configuration.network, configuration.indexerUri, configuration.indexerWsUri, globalThis.WebSocket);
  return createVerifiedChainReader(configuration, provider, node, new ReadOnlyAsOfIndexer(configuration.indexerUri));
}
/** Backend dependency-injection boundary for offline tests; production uses only the factory above. */
export function createVerifiedChainReader(configuration: GateEvent, provider: Parameters<typeof verifyReceipt>[0], node: CanonicalFinalityReader, asOf: AsOfStateReader): GateChainReader {
  const verifyState = localPinnedStateVerifier();
  const verifiedProvider: typeof provider = { ...provider, queryContractState: async (address, config) => {
    const state = await provider.queryContractState(address, config);
    if (state) await verifyState(state);
    return state;
  } };
  return {
    async readActiveBaseline(request) {
      assertNetwork(configuration.network);
      if (eventKey(request) !== eventKey(configuration)) throw new GateError('event-not-configured', 403);
      const baseline = await node.finalizedHead();
      blockHash(baseline.hash);
      if (!Number.isSafeInteger(baseline.height) || baseline.height < 0) throw new GateError('verification-failed', 503);
      const snapshot = await asOf.readContractState(configuration.contractAddress, baseline);
      if (snapshot) await verifyState(snapshot);
      // Decode the SAME key-verified snapshot. Never query latest or an exact-action SDK block for the baseline.
      const state = await readPublicState({ ...provider, queryContractState: async () => snapshot }, configuration.contractAddress, publicBytes(publicHex(request.commitment)));
      await node.assertFinalizedCanonical(baseline.hash, baseline.height);
      assertNetwork(configuration.network);
      if (!state || state.eventId !== configuration.eventId || state.issuerCommitment !== configuration.issuerCommitment || state.passStatus !== 'ACTIVE') throw new GateError('not-active', 409);
      return baseline;
    },
    async verifyRedemption(attempt, txId) {
      assertNetwork(configuration.network);
      const data = await provider.watchForTxData(txId);
      if (data.txId !== txId && !data.identifiers.includes(txId) || !data.tx || typeof data.tx.identifiers !== 'function' || !data.tx.identifiers().includes(txId) || data.blockHeight <= attempt.baselineBlockHeight) throw new GateError('verification-failed', 409);
      // Independent trusted node checks indexer block is canonical and already finalized.
      await node.assertFinalizedCanonical(data.blockHash, data.blockHeight);
      const receipt: PublicReceipt = await verifyReceipt(verifiedProvider, data, {
        network: configuration.network, action: 'redeem', contractAddress: configuration.contractAddress,
        eventId: publicBytes(configuration.eventId), issuerCommitment: publicBytes(configuration.issuerCommitment), commitment: publicBytes(attempt.commitment),
      });
      assertNetwork(configuration.network);
      // Reject incomplete public IDs even if an upstream decoder is permissive.
      transactionId(receipt.txId); publicHex(receipt.txHash); blockHash(receipt.blockHash);
      if (!receipt.identifiers.length || receipt.identifiers.length > 256) throw new GateError('verification-failed', 503);
      receipt.identifiers.forEach(transactionId);
      if (!Number.isFinite(receipt.blockTimestamp) || receipt.blockTimestamp < 0 || receipt.publicState.passStatus !== 'USED' || receipt.commitment !== attempt.commitment) throw new GateError('verification-failed', 503);
      return { ...receipt, action: 'redeem', commitment: attempt.commitment, publicState: { ...receipt.publicState, passStatus: 'USED' } };
    },
  };
}

import type { Network } from './receipts.js';

export interface ChainStatus {
  network: Network;
  nodeVersion: string;
  finalizedBlockHash: string;
  finalizedBlockHeight: number;
  checkedAt: string;
}
/** Read-only JSON-RPC. No wallet, account, signing, proving or submission methods. */
export async function readChainStatus(options: { network: Network; nodeRpcUri: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<ChainStatus> {
  if (!['preview', 'preprod', 'undeployed'].includes(options.network)) throw new Error('Only test networks are supported');
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  let id = 0;
  async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await fetchImpl(options.nodeRpcUri, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (!response.ok) throw new Error('Read-only node query failed');
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('result' in result) || 'error' in result) throw new Error('Invalid node JSON-RPC response');
    return result.result;
  }
  const [version, finalized] = await Promise.all([rpc('system_version'), rpc('chain_getFinalizedHead')]);
  if (typeof version !== 'string' || typeof finalized !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(finalized)) throw new Error('Invalid finalized node metadata');
  const header = await rpc('chain_getHeader', [finalized]);
  if (!header || typeof header !== 'object' || !('number' in header) || typeof header.number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(header.number)) throw new Error('Invalid finalized block header');
  const height = Number.parseInt(header.number.slice(2), 16);
  if (!Number.isSafeInteger(height)) throw new Error('Invalid finalized block height');
  return { network: options.network, nodeVersion: version, finalizedBlockHash: finalized, finalizedBlockHeight: height, checkedAt: new Date().toISOString() };
}

import type { Network } from './receipts.js';
export interface ChainStatus { network: Network; nodeVersion: string; finalizedBlockHash: string; finalizedBlockHeight: number; checkedAt: string; }
/** Only system_version, chain_getFinalizedHead, and chain_getHeader are sent. No account/transaction methods. */
export async function readChainStatus(options: { network: Network; nodeRpcUri: string; timeoutMs?: number; fetchImpl?: typeof fetch; webSocketImpl?: typeof WebSocket }): Promise<ChainStatus> {
  if (!['preview', 'preprod', 'undeployed'].includes(options.network)) throw new Error('Only test networks are supported');
  const url = new URL(options.nodeRpcUri), timeout = options.timeoutMs ?? 15_000;
  if (url.username || url.password || !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('Invalid read-only node endpoint');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'ws:'].includes(url.protocol)) throw new Error('Remote node queries require encrypted connections');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Positive read-only timeout required');
  const signal = AbortSignal.timeout(timeout);
  let id = 0, socket: WebSocket | undefined, connection: Promise<void> | undefined;
  let rejectConnection: ((error: Error) => void) | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const parse = (value: unknown, expectedId: number): unknown => {
    if (!value || typeof value !== 'object' || !('jsonrpc' in value) || value.jsonrpc !== '2.0' || !('result' in value) || 'error' in value || !('id' in value) || value.id !== expectedId) throw new Error('Invalid read-only node JSON-RPC response');
    return value.result;
  };
  const rejectAll = (error: Error) => { rejectConnection?.(error); for (const request of pending.values()) request.reject(error); pending.clear(); };
  const onAbort = () => { rejectAll(new Error('Read-only node query timed out')); socket?.close(); };
  signal.addEventListener('abort', onAbort, { once: true });
  async function rpc(method: 'system_version' | 'chain_getFinalizedHead' | 'chain_getHeader', params: unknown[] = []): Promise<unknown> {
    if (signal.aborted) throw new Error('Read-only node query timed out');
    const requestId = ++id, body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const response = await (options.fetchImpl ?? fetch)(url.href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body });
      if (!response.ok) throw new Error('Read-only node query failed');
      return parse(await response.json(), requestId);
    }
    if (!connection) {
      const Socket = options.webSocketImpl ?? globalThis.WebSocket;
      if (!Socket) throw new Error('Native browser WebSocket required for this wallet node endpoint');
      socket = new Socket(url.href);
      connection = new Promise<void>((resolve, reject) => { rejectConnection = reject; socket!.addEventListener('open', () => { rejectConnection = undefined; resolve(); }, { once: true }); });
      socket.addEventListener('close', () => rejectAll(new Error('Read-only node connection closed')));
      socket.addEventListener('error', () => rejectAll(new Error('Read-only node connection failed')));
      socket.addEventListener('message', event => {
        try {
          if (typeof event.data !== 'string') throw new Error('Invalid RPC message');
          const value = JSON.parse(event.data) as { id?: unknown };
          if (typeof value.id !== 'number') return;
          const request = pending.get(value.id); if (!request) return;
          pending.delete(value.id);
          try { request.resolve(parse(value, value.id)); } catch { request.reject(new Error('Invalid read-only node JSON-RPC response')); }
        } catch { rejectAll(new Error('Invalid read-only node response')); socket?.close(); }
      });
    }
    await connection;
    if (signal.aborted) throw new Error('Read-only node query timed out');
    return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); try { socket!.send(body); } catch { pending.delete(requestId); reject(new Error('Read-only node query failed')); } });
  }
  try {
    const [version, finalized] = await Promise.all([rpc('system_version'), rpc('chain_getFinalizedHead')]);
    if (typeof version !== 'string' || typeof finalized !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(finalized)) throw new Error('Invalid finalized node metadata');
    const header = await rpc('chain_getHeader', [finalized]);
    if (!header || typeof header !== 'object' || !('number' in header) || typeof header.number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(header.number)) throw new Error('Invalid finalized block header');
    const height = Number.parseInt(header.number.slice(2), 16);
    if (!Number.isSafeInteger(height)) throw new Error('Invalid finalized block height');
    return { network: options.network, nodeVersion: version, finalizedBlockHash: finalized, finalizedBlockHeight: height, checkedAt: new Date().toISOString() };
  } finally { signal.removeEventListener('abort', onAbort); socket?.close(); rejectAll(new Error('Read-only node query finished')); }
}

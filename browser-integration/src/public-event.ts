import { verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { publicBytes, publicHex } from './bytes.js';
import { ledger, PassStatus } from './generated/contract/index.js';
import { withReadTimeout } from './journal.js';
import { assertNetwork } from './providers.js';
import type { PublicStateSnapshot } from './receipts.js';
import { BrowserZkConfigProvider } from './zk-assets.js';

export interface PublicPreviewEvent {
  network: 'preview'; contractAddress: string; eventId: string; issuerCommitment: string;
}
function nonzeroHex(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || /^0+$/.test(value)) throw new Error('Expected nonzero public Preview identity');
  return value;
}

/** Walletless, public-only compatibility/status read. Uses the same pinned verifier
 * check as join, without session creation, private storage, proving or submission.
 * The caller must separately review the organiser identity and read endpoints.
 * This is latest indexed state, not a finalized receipt, gate baseline or admission.
 * adapter.join remains mandatory before any later wallet-authorized transaction.
 */
export async function verifyPublicEvent(options: {
  event: PublicPreviewEvent;
  publicDataProvider: PublicDataProvider;
  compiledAssetsBaseUrl: string;
  commitment?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PublicStateSnapshot> {
  const event = options.event;
  if (!event || event.network !== 'preview') throw new Error('Only Preview public events are supported');
  const contractAddress = nonzeroHex(event.contractAddress), eventId = nonzeroHex(event.eventId), issuerCommitment = nonzeroHex(event.issuerCommitment);
  const commitment = options.commitment === undefined ? undefined : publicBytes(nonzeroHex(options.commitment));
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 120_000) throw new Error('Invalid public verification timeout');
  assertNetwork('preview');
  const assets = new BrowserZkConfigProvider(options.compiledAssetsBaseUrl, options.fetchImpl);
  const [state, keys] = await withReadTimeout(Promise.all([
    options.publicDataProvider.queryContractState(contractAddress),
    assets.getVerifierKeys(['issue', 'redeem', 'revoke']),
  ]), timeout);
  assertNetwork('preview');
  if (!state) throw new Error('Expected public Preview contract is absent');
  verifyContractState(keys, state);
  // Decode the exact same public state whose keys were checked, avoiding a second
  // latest-state query racing a verifier/contract-state change.
  const decoded = ledger(state.data);
  if (publicHex(decoded.eventId) !== eventId || publicHex(decoded.issuerCommitment) !== issuerCommitment) throw new Error('Public Preview event or issuer identity mismatch');
  const status = commitment && decoded.passes.member(commitment) ? decoded.passes.lookup(commitment) : undefined;
  return { eventId, issuerCommitment, issuedCount: decoded.issuedCount.toString(), redeemedCount: decoded.redeemedCount.toString(), revokedCount: decoded.revokedCount.toString(),
    ...(commitment ? { passStatus: status === undefined ? 'NEVER_ISSUED' : status === PassStatus.ACTIVE ? 'ACTIVE' : status === PassStatus.USED ? 'USED' : 'REVOKED' } : {}) };
}

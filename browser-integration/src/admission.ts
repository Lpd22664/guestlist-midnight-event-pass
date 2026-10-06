import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { publicAddress, publicBytes } from './bytes.js';
import type { AttemptJournal } from './journal.js';
import { withReadTimeout } from './journal.js';
import { verifyReceipt, type Network, type PublicReceipt } from './receipts.js';

/** Owner-managed durable gate store. claim must atomically enforce global uniqueness
 * of the same network + contract + commitment, across every gate/restart/process.
 */
export interface AdmissionStore {
  claimOnce(key: string, receipt: PublicReceipt): Promise<boolean>;
}
/** Re-validates a journaled redemption against the trusted public provider, then
 * claims entry exactly once. A raw supplied receipt or USED public state is insufficient.
 */
export async function verifyAndClaimAdmission(options: {
  requestId: string;
  network: Network;
  contractAddress: string;
  eventId: string;
  issuerCommitment: string;
  commitment: string;
  journal: AttemptJournal;
  publicDataProvider: PublicDataProvider;
  admissions: AdmissionStore;
  timeoutMs?: number;
}): Promise<{ admit: boolean; receipt: PublicReceipt }> {
  const attempt = await options.journal.get(options.requestId);
  const contractAddress = publicAddress(options.contractAddress);
  if (!attempt || attempt.action !== 'redeem' || !attempt.txId ||
      attempt.network !== options.network || attempt.contractAddress !== contractAddress ||
      attempt.eventId !== options.eventId || attempt.issuerCommitment !== options.issuerCommitment ||
      attempt.commitment !== options.commitment) throw new Error('No matching redemption attempt; do not admit');
  const data = await withReadTimeout(options.publicDataProvider.watchForTxData(attempt.txId), options.timeoutMs ?? 120_000);
  if (data.txId !== attempt.txId && !data.identifiers.includes(attempt.txId)) throw new Error('Finalized transaction identifier mismatch');
  const receipt = await withReadTimeout(verifyReceipt(options.publicDataProvider, data, {
    network: options.network, action: 'redeem', contractAddress,
    eventId: publicBytes(options.eventId), issuerCommitment: publicBytes(options.issuerCommitment),
    commitment: publicBytes(options.commitment),
  }), options.timeoutMs ?? 120_000);
  const admit = await options.admissions.claimOnce(`${options.network}:${contractAddress}:${options.commitment}`, receipt);
  return { admit, receipt };
}

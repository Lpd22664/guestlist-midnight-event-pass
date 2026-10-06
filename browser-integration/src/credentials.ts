import { derivePassCommitment } from './contract.js';
import { bytes32, publicAddress, publicBytes, publicHex, equalBytes } from './bytes.js';
import type { Network } from './receipts.js';

export interface LiveEventIdentity { network: Network; contractAddress: string; eventId: string; }
/** A bearer capability, not a public receipt. Never log, persist unencrypted or put in a URL. */
export interface LiveCredential extends LiveEventIdentity {
  version: 1;
  mode: 'midnight';
  commitment: string;
  bearerSecret: Uint8Array;
}
const PREFIX = 'guestlist-midnight-v1:';
function identity(input: LiveEventIdentity): LiveEventIdentity {
  if (!['preview', 'preprod', 'undeployed'].includes(input.network)) throw new Error('Unsupported credential test network');
  return { network: input.network, contractAddress: publicAddress(input.contractAddress), eventId: publicHex(bytes32(publicBytes(input.eventId), 'Event ID')) };
}
/** Call only for an owner-approved presentation/transfer; no capability is generated here. */
export function encodeLiveCredential(input: LiveEventIdentity & { bearerSecret: Uint8Array }): string {
  const event = identity(input), bearerSecret = bytes32(input.bearerSecret, 'Bearer secret');
  const commitment = publicHex(derivePassCommitment(publicBytes(event.eventId), bearerSecret));
  return PREFIX + btoa(JSON.stringify({ version: 1, mode: 'midnight', ...event, commitment, bearerSecret: Array.from(bearerSecret, byte => byte.toString(16).padStart(2, '0')).join('') }));
}
/** The expected event must come from the host's trusted deployment registry, never from the QR itself. */
export function decodeLiveCredential(raw: string, trustedExpectedEvent: LiveEventIdentity): LiveCredential {
  try {
    const expected = identity(trustedExpectedEvent);
    if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith(PREFIX)) throw new Error('Invalid prefix');
    const parsed: unknown = JSON.parse(atob(raw.slice(PREFIX.length)));
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid envelope');
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some(key => !['version', 'mode', 'network', 'contractAddress', 'eventId', 'commitment', 'bearerSecret'].includes(key)) || record.version !== 1 || record.mode !== 'midnight') throw new Error('Invalid fields');
    for (const field of ['network', 'contractAddress', 'eventId'] as const) if (record[field] !== expected[field]) throw new Error('Wrong event identity');
    if (typeof record.bearerSecret !== 'string' || typeof record.commitment !== 'string') throw new Error('Missing capability');
    const bearerSecret = bytes32(publicBytes(record.bearerSecret), 'Bearer secret');
    const commitment = bytes32(publicBytes(record.commitment), 'Pass commitment');
    if (!equalBytes(derivePassCommitment(publicBytes(expected.eventId), bearerSecret), commitment)) throw new Error('Wrong commitment');
    return { version: 1, mode: 'midnight', ...expected, commitment: publicHex(commitment), bearerSecret };
  } catch { throw new Error('Invalid live credential or wrong trusted network/event/contract; no capability was accepted'); }
}

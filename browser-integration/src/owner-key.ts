import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
/** Owner-operated final action only. Importing this function creates no authority. */
export function ownerCreateMaintenanceSigningKey(options: { ownerConfirmedFinalAction: true; role: 'issuer' }): string {
  if (options.ownerConfirmedFinalAction !== true || options.role !== 'issuer') throw new Error('Issuer owner final action required before creating maintenance authority');
  return sampleSigningKey();
}

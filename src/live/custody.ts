import { bytesFromHex, hexFromBytes, ownerId, publicHex32, type Custody, type Role } from './model';
export interface RecoveryFile {
  schema: 'guestlist-owner-custody-v1'; network: 'preview'; role: Role;
  ownerAccountId: string; eventId: string; vaultKeyHex: string;
  issuerSecretHex?: string; bearerSecretHex?: string; maintenanceSigningKey?: string;
}
export type RecoveryMetadata = Readonly<{ role: Role; network: 'preview'; ownerAccountId: string; eventId: string }>;
type RecoveryScope = { role: Role; ownerAccountId: string; eventId: string };
const RECOVERY_REJECTED = 'Private recovery file was rejected. Check the Preview event, owner ID and role. No private material was accepted.';
function validRole(role: unknown): role is Role { return role === 'issuer' || role === 'bearer'; }
/** Validate in place without decoding, importing, retaining or returning private key bytes. */
function parseRecoveryFile(text: string, expectedRole: Role): RecoveryFile {
  if (typeof text !== 'string' || text.length > 8192 || !validRole(expectedRole)) throw new Error('Invalid recovery file');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery file');
  const file = value as RecoveryFile;
  const allowed = ['schema', 'network', 'role', 'ownerAccountId', 'eventId', 'vaultKeyHex', expectedRole === 'issuer' ? 'issuerSecretHex' : 'bearerSecretHex', ...(expectedRole === 'issuer' ? ['maintenanceSigningKey'] : [])];
  if (Object.keys(file).some(key => !allowed.includes(key)) || file.schema !== 'guestlist-owner-custody-v1' || file.network !== 'preview' || file.role !== expectedRole) throw new Error('Role/scope mismatch');
  ownerId(file.ownerAccountId);
  if (typeof file.eventId !== 'string' || typeof file.vaultKeyHex !== 'string') throw new Error('Invalid recovery file');
  publicHex32(file.eventId); publicHex32(file.vaultKeyHex);
  const capability = expectedRole === 'issuer' ? file.issuerSecretHex : file.bearerSecretHex;
  if (typeof capability !== 'string') throw new Error('Invalid recovery file');
  publicHex32(capability);
  if ('maintenanceSigningKey' in file && (typeof file.maintenanceSigningKey !== 'string' || !/^[0-9a-f]{64}$/.test(file.maintenanceSigningKey))) throw new Error('Invalid maintenance key');
  return file;
}
/** Pure owner-local inspection only. The exact public allowlist is safe to show before import consent. */
export function readOwnerRecoveryMetadata(text: string, expectedRole: Role): RecoveryMetadata {
  try {
    const file = parseRecoveryFile(text, expectedRole);
    return Object.freeze({ role: file.role, network: file.network, ownerAccountId: file.ownerAccountId, eventId: file.eventId });
  } catch { throw new Error(RECOVERY_REJECTED); }
}
/** Fill only empty public fields. An explicit identity must never be silently replaced. */
export function resolveRecoveryScope(metadata: RecoveryMetadata, entered: RecoveryScope): RecoveryMetadata {
  try {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(key => !['role', 'network', 'ownerAccountId', 'eventId'].includes(key)) || !validRole(metadata.role) || metadata.network !== 'preview' || typeof metadata.eventId !== 'string') throw new Error('Invalid recovery scope');
    const account = ownerId(metadata.ownerAccountId), event = publicHex32(metadata.eventId);
    if (!entered || !validRole(entered.role) || entered.role !== metadata.role || typeof entered.ownerAccountId !== 'string' || typeof entered.eventId !== 'string') throw new Error('Role/scope mismatch');
    if (entered.ownerAccountId !== '' && ownerId(entered.ownerAccountId) !== account || entered.eventId !== '' && publicHex32(entered.eventId) !== event) throw new Error('Role/scope mismatch');
    return Object.freeze({ role: metadata.role, network: 'preview', ownerAccountId: account, eventId: event });
  } catch { throw new Error(RECOVERY_REJECTED); }
}
/** Called only after the owner selects their own file and performs the local import. Never accepts a URL. */
export async function importOwnerFile(text: string, expected: RecoveryScope, cryptoImpl: Crypto = crypto): Promise<Custody> {
  let keyBytes: Uint8Array | undefined;
  try {
    const file = parseRecoveryFile(text, expected.role);
    if (file.eventId !== expected.eventId || file.ownerAccountId !== expected.ownerAccountId) throw new Error('Role/scope mismatch');
    keyBytes = bytesFromHex(file.vaultKeyHex);
    const capability = bytesFromHex(expected.role === 'issuer' ? file.issuerSecretHex! : file.bearerSecretHex!);
    const encryptionKey = await cryptoImpl.subtle.importKey('raw', keyBytes as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt','decrypt']);
    return { role: expected.role, eventId: publicHex32(expected.eventId), ownerAccountId: ownerId(expected.ownerAccountId), encryptionKey, capability, ...(file.maintenanceSigningKey ? { maintenanceSigningKey: file.maintenanceSigningKey } : {}) };
  } catch { throw new Error(RECOVERY_REJECTED); }
  finally { keyBytes?.fill(0); }
}
/** Owner-operated provisioning only: final control must be handed to the owner before this function is invoked. */
export async function createRecoveryFile(options: { role: Role; eventId: string; ownerAccountId: string; includeMaintenance: boolean; ownerConfirmedFinalAction: true; createMaintenanceKey: () => string }, cryptoImpl: Crypto = crypto): Promise<RecoveryFile> {
  if (options.ownerConfirmedFinalAction !== true) throw new Error('Explicit owner final action required to create persistent authority');
  const eventId = publicHex32(options.eventId), account = ownerId(options.ownerAccountId);
  if (options.role !== 'issuer' && options.role !== 'bearer' || options.role === 'bearer' && options.includeMaintenance) throw new Error('Role-specific custody required');
  const key = cryptoImpl.getRandomValues(new Uint8Array(32)), capability = cryptoImpl.getRandomValues(new Uint8Array(32));
  try {
    const recovery: RecoveryFile = { schema: 'guestlist-owner-custody-v1', network: 'preview', role: options.role, ownerAccountId: account, eventId, vaultKeyHex: hexFromBytes(key), ...(options.role === 'issuer' ? { issuerSecretHex: hexFromBytes(capability) } : { bearerSecretHex: hexFromBytes(capability) }) };
    if (options.includeMaintenance) recovery.maintenanceSigningKey = options.createMaintenanceKey();
    return recovery;
  } finally { key.fill(0); capability.fill(0); }
}
export function forgetCustody(custody?: Custody): void { custody?.capability.fill(0); }
/** Local download only, never upload/transmit or place private material in an app URL. */
export function downloadRecovery(file: RecoveryFile): void {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const href = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = href; anchor.download = `guestlist-${file.role}-private-recovery.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

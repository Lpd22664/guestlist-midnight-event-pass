import { forgetCustody, importOwnerFile, readOwnerRecoveryMetadata, type RecoveryMetadata, type RecoveryScope } from './custody';
import { hexFromBytes, ownerId, publicHex32, type Custody, type Role } from './model';

/** Separate from the SDK's existing per-owner vault and request-journal namespaces. */
export const DEVICE_VAULT_DATABASE = 'guestlist-device-custody-v1';
export const VAULT_PBKDF2_ITERATIONS = 600_000;
const SCHEMA = 'guestlist-password-custody-v1';
const MAX_RECOVERY_BYTES = 8192, MAX_BACKUP_CHARACTERS = 18000, MAX_RECORDS = 256;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const UNLOCK_FAILED = 'Saved vault could not be unlocked. Check your password and selected owner, event and role. Nothing was replaced.';
const INVALID_BACKUP = 'Encrypted recovery backup is invalid. No private material was accepted.';
const STORAGE_FAILED = 'Device vault is unavailable or unreadable. Keep site data and your recovery backup; nothing was replaced.';
const CANCELLED = 'Setup was cancelled. Private custody is locked.';
const ALREADY_SAVED = 'A vault is already saved for this owner, event and role. Unlock it with its password; existing authority is never replaced.';

export interface OwnerVaultApproval {
  /** Supplied only by the owner's explicit UI review, never inferred by this module. */
  ownerApproved: true;
  isCurrent: () => boolean;
  signal?: AbortSignal;
}
interface EncryptedRecovery extends RecoveryMetadata {
  schema: typeof SCHEMA;
  kdf: 'PBKDF2-SHA256';
  iterations: typeof VAULT_PBKDF2_ITERATIONS;
  saltHex: string;
  cipher: 'AES-256-GCM';
  ivHex: string;
  ciphertextHex: string;
}
export interface DeviceVaultOptions { indexedDBImpl?: IDBFactory; cryptoImpl?: Crypto; }
function scopeCopy(input: RecoveryScope): RecoveryMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.eventId !== 'string' || !['issuer', 'bearer'].includes(input.role)) throw new Error(INVALID_BACKUP);
  return Object.freeze({ network: 'preview', role: input.role, ownerAccountId: ownerId(input.ownerAccountId), eventId: publicHex32(input.eventId) });
}
export function vaultScopeKey(scope: RecoveryScope): string {
  const s = scopeCopy(scope);
  return JSON.stringify([s.network, s.ownerAccountId, s.eventId, s.role]);
}
function checkApproval(approval: OwnerVaultApproval): void {
  if (approval?.ownerApproved !== true || typeof approval.isCurrent !== 'function') throw new Error('Explicit owner review is required for private custody.');
  if (approval.signal?.aborted || !approval.isCurrent()) throw new Error(CANCELLED);
}
export function validateVaultPassword(password: string): void {
  if (typeof password !== 'string' || password.length > 256) throw new Error('Use a unique password or passphrase of 15–128 characters.');
  const length = Array.from(password).length;
  if (length < 15 || length > 128 || !password.trim() || /^(.)\1+$/u.test(password) || encoder.encode(password).length > 512) throw new Error('Use a unique password or passphrase of 15–128 characters.');
}
function hex(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || value.length !== bytes * 2 || !/^[0-9a-f]+$/.test(value)) throw new Error(INVALID_BACKUP);
  return value;
}
function fromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
}
function recordCopy(input: unknown): EncryptedRecovery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(INVALID_BACKUP);
  const v = input as EncryptedRecovery;
  const keys = ['schema', 'network', 'role', 'ownerAccountId', 'eventId', 'kdf', 'iterations', 'saltHex', 'cipher', 'ivHex', 'ciphertextHex'];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) || v.schema !== SCHEMA || v.network !== 'preview' || v.kdf !== 'PBKDF2-SHA256' || v.iterations !== VAULT_PBKDF2_ITERATIONS || v.cipher !== 'AES-256-GCM') throw new Error(INVALID_BACKUP);
  const scope = scopeCopy(v);
  if (typeof v.ciphertextHex !== 'string' || v.ciphertextHex.length < 34 || v.ciphertextHex.length > (MAX_RECOVERY_BYTES + 16) * 2 || v.ciphertextHex.length % 2 || !/^[0-9a-f]+$/.test(v.ciphertextHex)) throw new Error(INVALID_BACKUP);
  return Object.freeze({ schema: SCHEMA, ...scope, kdf: 'PBKDF2-SHA256', iterations: VAULT_PBKDF2_ITERATIONS, saltHex: hex(v.saltHex, 16), cipher: 'AES-256-GCM', ivHex: hex(v.ivHex, 12), ciphertextHex: v.ciphertextHex });
}
function parseBackup(text: string): EncryptedRecovery {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_CHARACTERS) throw new Error(INVALID_BACKUP);
  try { return recordCopy(JSON.parse(text)); } catch { throw new Error(INVALID_BACKUP); }
}
export function readEncryptedBackupMetadata(text: string, expectedRole: Role): RecoveryMetadata {
  const record = parseBackup(text);
  if (record.role !== expectedRole) throw new Error(INVALID_BACKUP);
  return scopeCopy(record);
}
function aad(record: Omit<EncryptedRecovery, 'ciphertextHex'>): Uint8Array<ArrayBuffer> {
  // Canonical field ordering binds format, KDF/cipher parameters, and the exact authority scope.
  return encoder.encode(JSON.stringify([record.schema, record.network, record.ownerAccountId, record.eventId, record.role, record.kdf, record.iterations, record.saltHex, record.cipher, record.ivHex]));
}
async function passwordKey(password: string, saltHex: string, cryptoImpl: Crypto, approval: OwnerVaultApproval): Promise<CryptoKey> {
  validateVaultPassword(password); checkApproval(approval);
  const bytes = encoder.encode(password);
  try {
    const base = await cryptoImpl.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    checkApproval(approval);
    const key = await cryptoImpl.subtle.deriveKey({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: VAULT_PBKDF2_ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    checkApproval(approval); return key;
  } finally { bytes.fill(0); }
}

/** Password wrapping restores the existing vault key and capabilities, never new authority.
 * This protects locked data at rest, not against malicious same-origin script or a compromised device.
 * JavaScript strings cannot be reliably zeroized; callers must clear password/file state promptly.
 */
export class DeviceVault {
  #idb?: IDBFactory;
  #crypto: Crypto;
  constructor(options: DeviceVaultOptions = {}) { this.#idb = options.indexedDBImpl ?? globalThis.indexedDB; this.#crypto = options.cryptoImpl ?? globalThis.crypto; }
  async #open(): Promise<IDBDatabase> {
    if (!this.#idb || !this.#crypto?.subtle) throw new Error(STORAGE_FAILED);
    return new Promise((resolve, reject) => {
      let failed = false;
      const request = this.#idb!.open(DEVICE_VAULT_DATABASE, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('records'); };
      request.onerror = request.onblocked = () => { failed = true; reject(new Error(STORAGE_FAILED)); };
      request.onsuccess = () => { if (failed) request.result.close(); else { request.result.onversionchange = () => request.result.close(); resolve(request.result); } };
    });
  }
  async #transaction<T>(mode: IDBTransactionMode, start: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void, approval?: OwnerVaultApproval): Promise<T> {
    if (approval) checkApproval(approval);
    const db = await this.#open();
    try {
      if (approval) checkApproval(approval);
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('records', mode);
        let value: T, failure: Error | undefined;
        const cancel = () => { failure = new Error(CANCELLED); try { tx.abort(); } catch { /* An already completed transaction cannot be rolled back. */ } };
        const cleanup = () => approval?.signal?.removeEventListener('abort', cancel);
        tx.oncomplete = () => { cleanup(); try { if (approval) checkApproval(approval); resolve(value); } catch { reject(new Error(CANCELLED)); } };
        tx.onabort = () => { cleanup(); reject(failure ?? new Error(STORAGE_FAILED)); };
        tx.onerror = () => { /* onabort reports a redacted, fixed error. */ };
        approval?.signal?.addEventListener('abort', cancel, { once: true });
        const fail = (error: Error) => { failure = error; tx.abort(); };
        try { if (approval) checkApproval(approval); start(tx.objectStore('records'), result => { value = result; }, fail); }
        catch { fail(new Error(approval?.signal?.aborted ? CANCELLED : STORAGE_FAILED)); }
      });
    } finally { db.close(); }
  }
  async list(): Promise<RecoveryMetadata[]> {
    return this.#transaction('readonly', (store, result, fail) => {
      const values: RecoveryMetadata[] = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        try {
          const cursor = request.result;
          if (!cursor) { result(values); return; }
          if (values.length >= MAX_RECORDS) throw new Error(STORAGE_FAILED);
          const record = recordCopy(cursor.value);
          if (cursor.key !== vaultScopeKey(record)) throw new Error(STORAGE_FAILED);
          values.push(scopeCopy(record)); cursor.continue();
        } catch { fail(new Error(STORAGE_FAILED)); }
      };
    });
  }
  async #read(scope: RecoveryScope, approval?: OwnerVaultApproval): Promise<EncryptedRecovery> {
    const key = vaultScopeKey(scope);
    return this.#transaction('readonly', (store, result, fail) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try { const record = recordCopy(request.result); if (vaultScopeKey(record) !== key) throw new Error(INVALID_BACKUP); result(record); }
        catch { fail(new Error(STORAGE_FAILED)); }
      };
    }, approval);
  }
  async #add(record: EncryptedRecovery, approval: OwnerVaultApproval, allowIdentical = false): Promise<void> {
    const safe = recordCopy(record), key = vaultScopeKey(safe);
    await this.#transaction<void>('readwrite', (store, result, fail) => {
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          checkApproval(approval);
          if (request.result !== undefined) {
            if (allowIdentical && JSON.stringify(recordCopy(request.result)) === JSON.stringify(safe)) { result(undefined); return; }
            fail(new Error(ALREADY_SAVED)); return;
          }
          const count = store.count();
          count.onsuccess = () => {
            try { checkApproval(approval); if (count.result >= MAX_RECORDS) throw new Error(STORAGE_FAILED); store.add(safe, key); result(undefined); }
            catch { fail(new Error(approval.signal?.aborted ? CANCELLED : STORAGE_FAILED)); }
          };
        } catch { fail(new Error(STORAGE_FAILED)); }
      };
    }, approval);
  }
  async remember(text: string, expected: RecoveryScope, password: string, approval: OwnerVaultApproval): Promise<RecoveryMetadata> {
    checkApproval(approval); validateVaultPassword(password);
    const scope = scopeCopy(expected), metadata = readOwnerRecoveryMetadata(text, scope.role);
    if (vaultScopeKey(metadata) !== vaultScopeKey(scope)) throw new Error(INVALID_BACKUP);
    const plaintext = encoder.encode(text);
    if (plaintext.length > MAX_RECOVERY_BYTES) { plaintext.fill(0); throw new Error(INVALID_BACKUP); }
    try {
      const header = { schema: SCHEMA, ...scope, kdf: 'PBKDF2-SHA256', iterations: VAULT_PBKDF2_ITERATIONS, saltHex: hexFromBytes(this.#crypto.getRandomValues(new Uint8Array(16))), cipher: 'AES-256-GCM', ivHex: hexFromBytes(this.#crypto.getRandomValues(new Uint8Array(12))) } as const;
      const key = await passwordKey(password, header.saltHex, this.#crypto, approval);
      const encrypted = await this.#crypto.subtle.encrypt({ name: 'AES-GCM', iv: fromHex(header.ivHex), additionalData: aad(header), tagLength: 128 }, key, plaintext);
      checkApproval(approval);
      await this.#add({ ...header, ciphertextHex: hexFromBytes(new Uint8Array(encrypted)) }, approval);
      return scope;
    } finally { plaintext.fill(0); }
  }
  async #unlockRecord(record: EncryptedRecovery, scope: RecoveryScope, password: string, approval: OwnerVaultApproval): Promise<Custody> {
    let plaintext: Uint8Array | undefined, custody: Custody | undefined;
    try {
      checkApproval(approval);
      if (vaultScopeKey(record) !== vaultScopeKey(scope)) throw new Error(INVALID_BACKUP);
      const key = await passwordKey(password, record.saltHex, this.#crypto, approval);
      const decrypted = await this.#crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(record.ivHex), additionalData: aad(record), tagLength: 128 }, key, fromHex(record.ciphertextHex));
      plaintext = new Uint8Array(decrypted); checkApproval(approval);
      if (plaintext.length > MAX_RECOVERY_BYTES) throw new Error(INVALID_BACKUP);
      custody = await importOwnerFile(decoder.decode(plaintext), scope, this.#crypto);
      checkApproval(approval); return custody;
    } catch { forgetCustody(custody); throw new Error(approval.signal?.aborted || !approval.isCurrent() ? CANCELLED : UNLOCK_FAILED); }
    finally { plaintext?.fill(0); }
  }
  async unlock(scope: RecoveryScope, password: string, approval: OwnerVaultApproval): Promise<Custody> {
    checkApproval(approval);
    try { const selected = scopeCopy(scope); return await this.#unlockRecord(await this.#read(selected, approval), selected, password, approval); }
    catch { throw new Error(approval.signal?.aborted || !approval.isCurrent() ? CANCELLED : UNLOCK_FAILED); }
  }
  /** Ciphertext only. Download is a separate, explicit local owner action. */
  async exportBackup(scope: RecoveryScope): Promise<string> { return JSON.stringify(await this.#read(scope)); }
  async importBackup(text: string, scope: RecoveryScope, password: string, approval: OwnerVaultApproval): Promise<Custody> {
    checkApproval(approval);
    const record = parseBackup(text);
    const custody = await this.#unlockRecord(record, scopeCopy(scope), password, approval);
    try { await this.#add(record, approval, true); checkApproval(approval); return custody; }
    catch (error) { forgetCustody(custody); throw error; }
  }
}

export function downloadEncryptedBackup(text: string, role: Role): void {
  readEncryptedBackupMetadata(text, role);
  const href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = `guestlist-${role}-encrypted-recovery.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

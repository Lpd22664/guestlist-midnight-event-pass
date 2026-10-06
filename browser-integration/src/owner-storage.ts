import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types';
import type { SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EventPassPrivateState } from './contract.js';
import { validatePrivateState } from './contract.js';
import { bytes32, publicAddress, publicBytes, publicHex } from './bytes.js';
import type { Attempt, AttemptJournal } from './journal.js';
import type { Network, PublicReceipt } from './receipts.js';

export interface OwnerScope {
  network: Network;
  /** Opaque owner/account identifier supplied by the host. Never derive encryption from it. */
  ownerAccountId: string;
  eventId: string;
  role: 'issuer' | 'bearer';
}
export interface StorageApproval {
  action: 'open-owner-private-store';
  scope: OwnerScope;
  persistsEncryptedCapabilities: true;
  persistsEncryptedMaintenanceKeys: boolean;
  keyIsSuppliedByOwner: true;
}
interface CipherRecord { version: 1; iv: Uint8Array; ciphertext: ArrayBuffer; }
const encoder = new TextEncoder();
const unresolved = new Set<Attempt['state']>(['started', 'submitting', 'submitted', 'unknown']);
const safeText = (value: unknown, label: string, max = 512): string => {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x20]/.test(value)) throw new Error(`Invalid public ${label}`);
  return value;
};
function checkScope(scope: OwnerScope): OwnerScope {
  if (!['preview', 'preprod', 'undeployed'].includes(scope.network) || !['issuer', 'bearer'].includes(scope.role)) throw new Error('Invalid owner storage scope');
  return { network: scope.network, ownerAccountId: safeText(scope.ownerAccountId, 'owner account identifier', 128), eventId: publicHex(bytes32(publicBytes(scope.eventId), 'Event ID')), role: scope.role };
}
function receiptCopy(receipt: PublicReceipt): PublicReceipt {
  const allowed = ['schema', 'network', 'action', 'contractAddress', 'txId', 'identifiers', 'txHash', 'blockHash', 'blockHeight', 'blockTimestamp', 'transactionStatus', 'stateCheck', 'eventId', 'commitment', 'publicState'];
  if (Object.keys(receipt).some(key => !allowed.includes(key))) throw new Error('Journal accepts public receipts only');
  if (receipt.schema !== 'midnight-event-pass-receipt-v1' || receipt.transactionStatus !== 'SucceedEntirely' || receipt.stateCheck !== 'verified-at-finalized-block') throw new Error('Invalid verified receipt');
  const publicStateKeys = ['eventId', 'issuerCommitment', 'issuedCount', 'redeemedCount', 'revokedCount', 'passStatus'];
  if (Object.keys(receipt.publicState).some(key => !publicStateKeys.includes(key))) throw new Error('Unexpected private receipt data');
  return structuredClone(receipt);
}
function attemptCopy(attempt: Attempt, scope: OwnerScope): Attempt {
  const allowed = ['requestId', 'network', 'action', 'contractAddress', 'eventId', 'issuerCommitment', 'commitment', 'state', 'expiresAt', 'candidateTxIds', 'txId', 'receipt'];
  if (Object.keys(attempt).some(key => !allowed.includes(key))) throw new Error('Journal accepts public attempts only');
  if (attempt.network !== scope.network || attempt.eventId !== scope.eventId) throw new Error('Attempt does not belong to this owner/event scope');
  if (!['deploy', 'issue', 'redeem', 'revoke'].includes(attempt.action) || !['started', 'submitting', 'submitted', 'unknown', 'verified', 'failed-before-submit'].includes(attempt.state)) throw new Error('Invalid public attempt state');
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(attempt.requestId) || !Number.isFinite(attempt.expiresAt)) throw new Error('Invalid public request identifier or expiration');
  publicBytes(attempt.eventId); publicBytes(attempt.issuerCommitment);
  if (attempt.contractAddress) publicAddress(attempt.contractAddress);
  if (attempt.commitment) publicBytes(attempt.commitment);
  if (attempt.txId) safeText(attempt.txId, 'transaction identifier');
  if (attempt.candidateTxIds) {
    if (!Array.isArray(attempt.candidateTxIds) || attempt.candidateTxIds.length > 32) throw new Error('Invalid transaction identifiers');
    attempt.candidateTxIds.forEach(id => safeText(id, 'transaction identifier'));
  }
  if (attempt.state === 'verified' && !attempt.receipt) throw new Error('A verified attempt requires its public receipt');
  const copy = structuredClone(attempt);
  if (attempt.receipt) {
    copy.receipt = receiptCopy(attempt.receipt);
    if (copy.receipt.network !== attempt.network || copy.receipt.eventId !== attempt.eventId || copy.receipt.action !== attempt.action || copy.receipt.contractAddress !== attempt.contractAddress || (copy.receipt.txId !== attempt.txId && !copy.receipt.identifiers.includes(attempt.txId ?? '')) || copy.receipt.commitment !== attempt.commitment) throw new Error('Receipt does not match its public attempt');
  }
  return copy;
}
/** No default password/key, key generation, wallet seed extraction, or plaintext fallback. */
export async function openOwnerStorage(options: {
  scope: OwnerScope;
  /** Existing owner-provisioned nonextractable AES-GCM-256 key, retained only in memory. */
  encryptionKey: CryptoKey;
  authorize: (request: StorageApproval) => Promise<boolean>;
  indexedDBImpl?: IDBFactory;
  cryptoImpl?: Crypto;
}): Promise<{ scope: OwnerScope; privateStateProvider: PrivateStateProvider<string, EventPassPrivateState>; journal: AttemptJournal; close(): void }> {
  const scope = checkScope(options.scope), key = options.encryptionKey;
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const idb = options.indexedDBImpl ?? globalThis.indexedDB;
  if (!idb || !cryptoImpl?.subtle) throw new Error('IndexedDB and secure-context Web Crypto are required');
  if (!key || key.type !== 'secret' || key.extractable || key.algorithm.name !== 'AES-GCM' || !('length' in key.algorithm) || key.algorithm.length !== 256 || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw new Error('Provide an existing owner-provisioned nonextractable AES-GCM-256 encryption key');
  if (!await options.authorize({ action: 'open-owner-private-store', scope, persistsEncryptedCapabilities: true, persistsEncryptedMaintenanceKeys: scope.role === 'issuer', keyIsSuppliedByOwner: true })) throw new Error('Owner private-storage approval was not granted');
  const namespace = JSON.stringify(scope);
  const nameDigest = publicHex(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', encoder.encode(namespace))));
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(`midnight-event-pass-v1-${nameDigest}`, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('vault'); request.result.createObjectStore('attempts', { keyPath: 'requestId' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Owner private storage could not be opened'));
    request.onblocked = () => reject(new Error('Owner private storage is blocked by another browser tab'));
  });
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  function transaction<T>(storeName: 'vault' | 'attempts', mode: IDBTransactionMode, start: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    if (closed) return Promise.reject(new Error('Owner storage is closed; unlock a new session'));
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let value: T, failure: Error | undefined;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? new Error('Owner storage transaction failed; no success is inferred'));
      tx.onerror = () => { /* onabort delivers the redacted error */ };
      try { start(tx.objectStore(storeName), result => { value = result; }, error => { failure = error; tx.abort(); }); }
      catch { failure = new Error('Owner storage operation failed'); tx.abort(); }
    });
  }
  async function seal(recordKey: string, value: unknown): Promise<CipherRecord> {
    const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${namespace}:${recordKey}`), tagLength: 128 }, key, encoder.encode(JSON.stringify(value)));
    return { version: 1, iv, ciphertext };
  }
  async function unseal(recordKey: string, record: CipherRecord): Promise<unknown> {
    try {
      if (record.version !== 1 || !(record.iv instanceof Uint8Array) || record.iv.length !== 12 || !(record.ciphertext instanceof ArrayBuffer)) throw new Error('Invalid record');
      const plaintext = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(record.iv), additionalData: encoder.encode(`${namespace}:${recordKey}`), tagLength: 128 }, key, record.ciphertext);
      return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    } catch { throw new Error('Owner private record cannot be decrypted; wrong key or corrupt storage'); }
  }
  async function put(recordKey: string, value: unknown): Promise<void> {
    const record = await seal(recordKey, value);
    await transaction<void>('vault', 'readwrite', (store, result) => { store.put(record, recordKey); result(undefined); });
  }
  async function get(recordKey: string): Promise<unknown | null> {
    const record = await transaction<CipherRecord | undefined>('vault', 'readonly', (store, result) => { const request = store.get(recordKey); request.onsuccess = () => result(request.result as CipherRecord | undefined); });
    return record === undefined ? null : unseal(recordKey, record);
  }
  async function removeKeys(prefix: string): Promise<void> {
    await transaction<void>('vault', 'readwrite', (store, result) => {
      const request = store.openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { if (String(cursor.key).startsWith(prefix)) cursor.delete(); cursor.continue(); } else result(undefined); };
    });
  }
  let contractAddress: string | undefined;
  const stateKey = (id: string): string => {
    if (!contractAddress) throw new Error('Set the expected contract address before accessing private state');
    return `state:${contractAddress}:${safeText(id, 'private state identifier', 256)}`;
  };
  const unavailable = async (): Promise<never> => { throw new Error('Vault import/export is disabled; owner recovery must use a separately reviewed secure handoff'); };
  const privateStateProvider: PrivateStateProvider<string, EventPassPrivateState> = {
    setContractAddress: address => { contractAddress = publicAddress(address); },
    set: async (id, input) => {
      const recordKey = stateKey(id), state = validatePrivateState(input);
      if (scope.role === 'bearer' && state.issuerSecret || scope.role === 'issuer' && state.bearerSecret) throw new Error('Private capability does not belong to this owner role');
      await put(recordKey, { ...(state.issuerSecret ? { issuer: Array.from(state.issuerSecret) } : {}), ...(state.bearerSecret ? { bearer: Array.from(state.bearerSecret) } : {}) });
    },
    get: async id => {
      const value = await get(stateKey(id));
      if (value === null) return null;
      if (!value || typeof value !== 'object') throw new Error('Invalid owner private record');
      const record = value as Record<string, unknown>;
      const capability = (input: unknown): Uint8Array => {
        if (!Array.isArray(input) || input.length !== 32 || input.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error('Invalid stored private capability');
        return Uint8Array.from(input as number[]);
      };
      const state = validatePrivateState({ ...(record.issuer ? { issuerSecret: capability(record.issuer) } : {}), ...(record.bearer ? { bearerSecret: capability(record.bearer) } : {}) });
      if (Object.keys(record).some(name => !['issuer', 'bearer'].includes(name)) || scope.role === 'bearer' && state.issuerSecret || scope.role === 'issuer' && state.bearerSecret) throw new Error('Wrong owner private record role');
      return state;
    },
    remove: async id => { const recordKey = stateKey(id); await transaction<void>('vault', 'readwrite', (store, result) => { store.delete(recordKey); result(undefined); }); },
    clear: async () => { if (!contractAddress) throw new Error('Contract address required'); await removeKeys(`state:${contractAddress}:`); },
    setSigningKey: async (address, signingKey: SigningKey) => {
      if (scope.role !== 'issuer' || !/^[a-fA-F0-9]{64}$/.test(signingKey) || /^0+$/.test(signingKey)) throw new Error('Explicit issuer-owned existing maintenance key required');
      await put(`maintenance:${publicAddress(address)}`, { signingKey });
    },
    getSigningKey: async address => {
      const value = await get(`maintenance:${publicAddress(address)}`);
      if (value === null) return null;
      if (!value || typeof value !== 'object' || !('signingKey' in value) || typeof value.signingKey !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.signingKey)) throw new Error('Invalid owner maintenance record');
      return value.signingKey;
    },
    removeSigningKey: async address => { const recordKey = `maintenance:${publicAddress(address)}`; await transaction<void>('vault', 'readwrite', (store, result) => { store.delete(recordKey); result(undefined); }); },
    clearSigningKeys: () => removeKeys('maintenance:'),
    exportPrivateStates: unavailable, importPrivateStates: unavailable, exportSigningKeys: unavailable, importSigningKeys: unavailable,
  };
  const journal: AttemptJournal = {
    create: async input => {
      const attempt = attemptCopy(input, scope);
      if (attempt.state !== 'started' || attempt.txId || attempt.receipt) throw new Error('A new attempt must start before submission');
      await transaction<void>('attempts', 'readwrite', (store, result, fail) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const rows = request.result as Attempt[];
          if (rows.some(row => row.requestId === attempt.requestId)) return fail(new Error('Duplicate requestId; reconcile the existing attempt'));
          if (rows.some(row => row.eventId === attempt.eventId && unresolved.has(row.state))) return fail(new Error('Unresolved event operation; reconcile before starting another'));
          store.add(attempt); result(undefined);
        };
      });
    },
    get: async requestId => {
      safeText(requestId, 'request identifier', 128);
      return transaction<Attempt | null>('attempts', 'readonly', (store, result, fail) => {
        const request = store.get(requestId);
        request.onsuccess = () => { try { result(request.result ? attemptCopy(request.result as Attempt, scope) : null); } catch { fail(new Error('Invalid stored public attempt')); } };
      });
    },
    update: async input => {
      const attempt = attemptCopy(input, scope);
      await transaction<void>('attempts', 'readwrite', (store, result, fail) => {
        const request = store.get(attempt.requestId);
        request.onsuccess = () => {
          const previous = request.result as Attempt | undefined;
          if (!previous) return fail(new Error('Unknown requestId; never create an attempt by updating'));
          if (['network', 'action', 'eventId', 'issuerCommitment', 'commitment'].some(field => previous[field as keyof Attempt] !== attempt[field as keyof Attempt]) || previous.contractAddress && previous.contractAddress !== attempt.contractAddress || previous.txId && previous.txId !== attempt.txId) return fail(new Error('Attempt identity cannot change'));
          if (previous.state === 'verified') { result(undefined); return; }
          if (previous.state === 'failed-before-submit' && attempt.state !== 'failed-before-submit') return fail(new Error('Failed pre-submit attempt cannot be reused'));
          // A late watchdog update cannot erase a recovered final receipt; unknown never regresses to pending.
          const next = previous.state === 'unknown' && ['started', 'submitting', 'submitted'].includes(attempt.state) ? { ...attempt, state: 'unknown' as const } : attempt;
          store.put(next); result(undefined);
        };
      });
    },
  };
  return { scope, privateStateProvider, journal, close: () => { closed = true; db.close(); } };
}

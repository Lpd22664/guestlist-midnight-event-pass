import { expect, test, type Page } from '@playwright/test';
import type { RecoveryScope } from '../src/live/custody';
import type { OwnerVaultApproval } from '../src/live/device-vault';

type VaultModule = typeof import('../src/live/device-vault');
type CustodyModule = typeof import('../src/live/custody');

// Public, fixed test data only. This is not the recorded Preview deployment and
// these bytes never confer real owner authority. No wallet, prover or SDK loads.
const syntheticEvent = {
  network: 'preview',
  contractAddress: 'e1'.repeat(32),
  eventId: 'e2'.repeat(32),
  issuerCommitment: 'e3'.repeat(32),
} as const;
const scope: RecoveryScope = {
  role: 'issuer', ownerAccountId: 'synthetic-browser-vault-owner', eventId: syntheticEvent.eventId,
};
const recovery = {
  schema: 'guestlist-owner-custody-v1', network: 'preview', ...scope,
  vaultKeyHex: 'a1'.repeat(32), issuerSecretHex: 'a2'.repeat(32), maintenanceSigningKey: 'a3'.repeat(32),
};
const input = {
  modulePath: '/src/live/device-vault.ts', custodyPath: '/src/live/custody.ts',
  scope, recoveryText: JSON.stringify(recovery), password: 'synthetic browser fixture passphrase',
};
const harnessPath = '/__guestlist-device-vault-e2e__';

async function openHarness(page: Page): Promise<void> {
  // Serve a script-free document at the local Vite origin. Only the explicitly
  // imported custody modules run; no app startup, public-chain reads or wallet UI.
  await page.route(`**${harnessPath}`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Synthetic DeviceVault test</title>',
  }));
  await page.goto(harnessPath);
  expect(await page.evaluate(() => ({
    secure: isSecureContext,
    crypto: crypto.subtle instanceof SubtleCrypto,
    indexedDB: indexedDB instanceof IDBFactory,
  }))).toEqual({ secure: true, crypto: true, indexedDB: true });
}

/** Read the actual browser store, including keys, without normalizing its values. */
async function storedRecords(page: Page): Promise<string> {
  return page.evaluate(async ({ modulePath }) => {
    const { DEVICE_VAULT_DATABASE } = await import(modulePath) as VaultModule;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DEVICE_VAULT_DATABASE, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const transaction = db.transaction('records', 'readonly');
        const store = transaction.objectStore('records');
        const keys = store.getAllKeys(), values = store.getAll();
        transaction.oncomplete = () => resolve(JSON.stringify({ keys: keys.result, values: values.result }));
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }, input);
}

test.describe('DeviceVault with native browser crypto and storage', () => {
  test.skip(process.env.GUESTLIST_TEST_URL !== undefined,
    'Local Vite source-module harness only: a deployed GUESTLIST_TEST_URL does not serve /src and must not receive synthetic custody writes.');

  test.beforeEach(async ({ page }) => { await openHarness(page); });

  test('remember persists only ciphertext and reload unlocks the identical nonextractable vault key', async ({ page }) => {
    const saved = await page.evaluate(async ({ modulePath, custodyPath, recoveryText, scope, password }) => {
      const { DeviceVault } = await import(modulePath) as VaultModule;
      const { importOwnerFile, forgetCustody } = await import(custodyPath) as CustodyModule;
      // Synthetic harness approval only; never authorizes a real owner's custody.
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      const vault = new DeviceVault(); // Real global IndexedDB and WebCrypto, no injected substitutes.
      const initial = await vault.list();
      const original = await importOwnerFile(recoveryText, scope);
      try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, original.encryptionKey,
          new TextEncoder().encode('synthetic pre-reload vault-key continuity probe'));
        const metadata = await vault.remember(recoveryText, scope, password, testOnlyApproval);
        return { initial, metadata, iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
      } finally { forgetCustody(original); }
    }, input);
    expect(saved.initial).toEqual([]);
    expect(saved.metadata).toEqual({ network: 'preview', ...scope });
    const beforeReload = await storedRecords(page);
    expect(JSON.parse(beforeReload).values).toHaveLength(1);
    for (const plaintext of [input.password, recovery.vaultKeyHex, recovery.issuerSecretHex,
      recovery.maintenanceSigningKey, 'vaultKeyHex', 'issuerSecretHex', 'maintenanceSigningKey']) {
      expect(beforeReload).not.toContain(plaintext);
    }

    await page.reload();
    const restored = await page.evaluate(async ({ fixture, iv, ciphertext }) => {
      const { DeviceVault } = await import(fixture.modulePath) as VaultModule;
      const { forgetCustody } = await import(fixture.custodyPath) as CustodyModule;
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      const vault = new DeviceVault();
      const metadata = await vault.list();
      const custody = await vault.unlock(fixture.scope, fixture.password, testOnlyApproval);
      try {
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) },
          custody.encryptionKey, new Uint8Array(ciphertext));
        let exportRejected = false;
        try { await crypto.subtle.exportKey('raw', custody.encryptionKey); } catch { exportRejected = true; }
        return {
          metadata, role: custody.role, ownerAccountId: custody.ownerAccountId, eventId: custody.eventId,
          capability: Array.from(custody.capability), maintenanceSigningKey: custody.maintenanceSigningKey,
          nativeKey: custody.encryptionKey instanceof CryptoKey, extractable: custody.encryptionKey.extractable,
          exportRejected, plaintext: new TextDecoder().decode(decrypted),
          localStorage: Object.keys(localStorage), sessionStorage: Object.keys(sessionStorage),
        };
      } finally { forgetCustody(custody); }
    }, { fixture: input, iv: saved.iv, ciphertext: saved.ciphertext });
    expect(restored).toEqual({
      metadata: [{ network: 'preview', ...scope }], ...scope,
      capability: Array(32).fill(0xa2), maintenanceSigningKey: recovery.maintenanceSigningKey,
      nativeKey: true, extractable: false, exportRejected: true,
      plaintext: 'synthetic pre-reload vault-key continuity probe', localStorage: [], sessionStorage: [],
    });
    expect(await storedRecords(page)).toBe(beforeReload);
  });

  test('wrong password and a replacement attempt leave the stored original authority unchanged', async ({ page }) => {
    await page.evaluate(async ({ modulePath, recoveryText, scope, password }) => {
      const { DeviceVault } = await import(modulePath) as VaultModule;
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      await new DeviceVault().remember(recoveryText, scope, password, testOnlyApproval);
    }, input);
    const originalRecord = await storedRecords(page);
    const wrongPassword = await page.evaluate(async ({ modulePath, custodyPath, scope }) => {
      const { DeviceVault } = await import(modulePath) as VaultModule;
      const { forgetCustody } = await import(custodyPath) as CustodyModule;
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      try {
        const custody = await new DeviceVault().unlock(scope, 'incorrect synthetic browser passphrase', testOnlyApproval);
        forgetCustody(custody); return null;
      } catch (error) { return (error as Error).message; }
    }, input);
    expect(wrongPassword).toContain('could not be unlocked');
    expect(await storedRecords(page)).toBe(originalRecord);
    const replacement = await page.evaluate(async ({ modulePath, recoveryText, scope }) => {
      const { DeviceVault } = await import(modulePath) as VaultModule;
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      const changed = JSON.stringify({ ...JSON.parse(recoveryText), issuerSecretHex: 'b2'.repeat(32) });
      try {
        await new DeviceVault().remember(changed, scope, 'replacement synthetic browser passphrase', testOnlyApproval);
        return null;
      } catch (error) { return (error as Error).message; }
    }, input);
    expect(replacement).toContain('already saved');
    expect(await storedRecords(page)).toBe(originalRecord);
    const originalCapability = await page.evaluate(async ({ modulePath, custodyPath, scope, password }) => {
      const { DeviceVault } = await import(modulePath) as VaultModule;
      const { forgetCustody } = await import(custodyPath) as CustodyModule;
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      const custody = await new DeviceVault().unlock(scope, password, testOnlyApproval);
      try { return Array.from(custody.capability); } finally { forgetCustody(custody); }
    }, input);
    expect(originalCapability).toEqual(Array(32).fill(0xa2));
    expect(await storedRecords(page)).toBe(originalRecord);
  });

  test('cancellation fails closed and an encrypted backup restores into a fresh browser context', async ({ page, browser, baseURL }) => {
    const source = await page.evaluate(async ({ modulePath, custodyPath, recoveryText, scope, password }) => {
      const { DeviceVault } = await import(modulePath) as VaultModule;
      const { forgetCustody } = await import(custodyPath) as CustodyModule;
      const vault = new DeviceVault();
      const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
      const cancelledSave = new AbortController();
      const pendingSave = vault.remember(recoveryText, scope, password,
        { ...testOnlyApproval, signal: cancelledSave.signal });
      cancelledSave.abort(); // Cancels a pending native operation, without stubbing crypto.
      let saveError: string | null = null;
      try { await pendingSave; } catch (error) { saveError = (error as Error).message; }
      const afterCancelledSave = await vault.list();
      await vault.remember(recoveryText, scope, password, testOnlyApproval);
      const backup = await vault.exportBackup(scope);
      const cancelledUnlock = new AbortController();
      const pendingUnlock = vault.unlock(scope, password, { ...testOnlyApproval, signal: cancelledUnlock.signal });
      cancelledUnlock.abort();
      let unlockError: string | null = null;
      try { forgetCustody(await pendingUnlock); } catch (error) { unlockError = (error as Error).message; }
      return { saveError, afterCancelledSave, unlockError, backup, afterCancelledUnlock: await vault.exportBackup(scope) };
    }, input);
    expect(source.saveError).toContain('cancelled');
    expect(source.afterCancelledSave).toEqual([]);
    expect(source.unlockError).toContain('cancelled');
    expect(source.afterCancelledUnlock).toBe(source.backup);
    const originalRecord = await storedRecords(page);

    // A separate ephemeral browser context has genuinely independent native IDB.
    const destination = await browser.newContext({ baseURL, viewport: page.viewportSize() ?? undefined });
    try {
      const destinationPage = await destination.newPage();
      await openHarness(destinationPage);
      const imported = await destinationPage.evaluate(async ({ fixture, backup }) => {
        const { DeviceVault } = await import(fixture.modulePath) as VaultModule;
        const { forgetCustody } = await import(fixture.custodyPath) as CustodyModule;
        const vault = new DeviceVault();
        const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
        const initial = await vault.list();
        const cancelledImport = new AbortController();
        const pending = vault.importBackup(backup, fixture.scope, fixture.password,
          { ...testOnlyApproval, signal: cancelledImport.signal });
        cancelledImport.abort();
        let cancelError: string | null = null;
        try { forgetCustody(await pending); } catch (error) { cancelError = (error as Error).message; }
        const afterCancellation = await vault.list();
        let wrongPasswordError: string | null = null;
        try {
          forgetCustody(await vault.importBackup(backup, fixture.scope, 'wrong synthetic backup passphrase', testOnlyApproval));
        } catch (error) { wrongPasswordError = (error as Error).message; }
        const afterWrongPassword = await vault.list();
        forgetCustody(await vault.importBackup(backup, fixture.scope, fixture.password, testOnlyApproval));
        // Re-importing the identical encrypted backup is safe and idempotent.
        forgetCustody(await vault.importBackup(backup, fixture.scope, fixture.password, testOnlyApproval));
        return { initial, cancelError, afterCancellation, wrongPasswordError, afterWrongPassword,
          restoredBackup: await vault.exportBackup(fixture.scope), metadata: await vault.list() };
      }, { fixture: input, backup: source.backup });
      expect(imported.initial).toEqual([]);
      expect(imported.cancelError).toContain('cancelled');
      expect(imported.afterCancellation).toEqual([]);
      expect(imported.wrongPasswordError).toContain('could not be unlocked');
      expect(imported.afterWrongPassword).toEqual([]);
      expect(imported.restoredBackup).toBe(source.backup);
      expect(imported.metadata).toEqual([{ network: 'preview', ...scope }]);
      expect(await storedRecords(destinationPage)).toBe(originalRecord);

      await destinationPage.reload();
      const restored = await destinationPage.evaluate(async ({ modulePath, custodyPath, scope, password }) => {
        const { DeviceVault } = await import(modulePath) as VaultModule;
        const { forgetCustody } = await import(custodyPath) as CustodyModule;
        const testOnlyApproval: OwnerVaultApproval = { ownerApproved: true, isCurrent: () => true };
        const custody = await new DeviceVault().unlock(scope, password, testOnlyApproval);
        try {
          return { role: custody.role, ownerAccountId: custody.ownerAccountId, eventId: custody.eventId,
            capability: Array.from(custody.capability),
            maintenanceSigningKey: custody.maintenanceSigningKey, extractable: custody.encryptionKey.extractable };
        } finally { forgetCustody(custody); }
      }, input);
      expect(restored).toEqual({ ...scope, capability: Array(32).fill(0xa2),
        maintenanceSigningKey: recovery.maintenanceSigningKey, extractable: false });
      expect(await storedRecords(destinationPage)).toBe(originalRecord);
      expect(await storedRecords(page)).toBe(originalRecord);
    } finally { await destination.close(); }
  });
});

import assert from 'node:assert/strict';
import { PassError, type Command, type DemoState, type FailureCode, type Pass } from '../src/domain';

// Public synthetic fixtures only. No wallet, chain, or real attendee information.
export const NOW = new Date('2026-10-05T17:00:00.000Z');
export const STORAGE_KEY = 'guestlist.synthetic-preview.v1';
export const secret = (number: number) => number.toString(16).padStart(64, '0');
export const issue = (number = 100, label = 'Synthetic Guest'): Command => ({ type: 'issue', label, passType: 'Guest', secret: secret(number) });
export const clone = <T>(value: T): T => structuredClone(value);
export const readyPass = (state: DemoState): Pass => state.passes.find(pass => pass.status === 'ready' && Date.parse(pass.expiresAt) > NOW.getTime())!;
export const rawCredential = (overrides: Record<string, unknown> = {}) => `guestlist-demo:${btoa(JSON.stringify({ version: 1, mode: 'demo', eventId: 'builders-table-2026', passId: secret(1), secret: secret(2), ...overrides }))}`;
export async function rejectsCode(action: () => Promise<unknown>, code: FailureCode) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof PassError, `Expected PassError(${code}), got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}
export function throwsCode(action: () => unknown, code: FailureCode) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PassError, `Expected PassError(${code}), got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

export class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  readError = false;
  writeError = false;
  writes = 0;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { if (this.readError) throw new Error('Synthetic read failure'); return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { if (this.writeError) throw new Error('Synthetic write failure'); this.writes++; this.values.set(key, String(value)); }
}

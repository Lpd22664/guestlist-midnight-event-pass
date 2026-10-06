import type { PublicHistoryLock } from '../src/live/public-history';
/** Explicit synthetic same-origin lock shared across all fixture controllers, not a production fallback. */
export function sharedHistoryLock(): PublicHistoryLock {
  const tails = new Map<string, Promise<void>>();
  return { async request<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
    const before = tails.get(name) ?? Promise.resolve();
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const tail = before.then(() => held); tails.set(name, tail);
    await before;
    try { return await operation(); } finally { release(); if (tails.get(name) === tail) tails.delete(name); }
  } };
}

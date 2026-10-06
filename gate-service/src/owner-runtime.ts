/** Pure version policy plus an explicitly called local, non-network SQLite probe. */
import { DatabaseSync } from 'node:sqlite';
export function assertRuntimeVersions(nodeVersion: string, sqliteVersion: string): void {
  const node = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeVersion);
  if (!node || Number(node[1]) !== 24 || Number(node[2]) < 19) throw new Error('Node >=24.19.0 <25 required');
  const sqlite = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(sqliteVersion);
  if (!sqlite || Number(sqlite[1]) < 3 || Number(sqlite[1]) === 3 &&
      (Number(sqlite[2]) < 51 || Number(sqlite[2]) === 51 && Number(sqlite[3]) < 3)) throw new Error('SQLite >=3.51.3 required');
}
export function checkOwnerRuntime(): void {
  // Check Node first, before attempting any owner config I/O or authority creation.
  assertRuntimeVersions(process.versions.node, '3.51.3');
  const probe = new DatabaseSync(':memory:', { allowExtension: false });
  try { assertRuntimeVersions(process.versions.node, String(probe.prepare('SELECT sqlite_version() AS version').get()?.version ?? '')); }
  finally { probe.close(); }
}

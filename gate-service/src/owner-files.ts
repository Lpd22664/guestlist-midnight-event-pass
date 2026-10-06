/** Local database instance identity; public metadata, not authority or rollback attestation. */
import { fstatSync, lstatSync, type BigIntStats } from 'node:fs';
import { record } from './validation.js';
export interface StorageFileIdentity { device: string; inode: string; birthtimeNs: string }
export function storageIdentity(input: unknown): StorageFileIdentity {
  const value = record(input, ['device', 'inode', 'birthtimeNs']);
  if (Object.values(value).some(item => typeof item !== 'string' || !/^(?:0|[1-9][0-9]{0,39})$/.test(item)) || value.inode === '0') throw new Error('Invalid local database identity');
  return { device: value.device as string, inode: value.inode as string, birthtimeNs: value.birthtimeNs as string };
}
function identity(stat: BigIntStats): StorageFileIdentity {
  return { device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
}
export function databaseDescriptorIdentity(fd: number): StorageFileIdentity { return identity(fstatSync(fd, { bigint: true })); }
export function assertDatabaseIdentity(path: string, expected: StorageFileIdentity): void {
  const checked = storageIdentity(expected), stat = lstatSync(path, { bigint: true });
  if (!process.getuid || !stat.isFile() || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o777n) !== 0o600n || stat.nlink !== 1n) throw new Error('Original private owner database required');
  const actual = identity(stat);
  if (actual.device !== checked.device || actual.inode !== checked.inode || actual.birthtimeNs !== checked.birthtimeNs) throw new Error('Database instance changed; preserve admission history');
}

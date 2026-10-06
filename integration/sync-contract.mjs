import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const original = new URL('../contracts/generated/event-pass/contract/', import.meta.url);
const source = new URL('./src/generated/contract/', import.meta.url);
await mkdir(source, { recursive: true });
for (const name of ['index.js', 'index.d.ts']) {
  // Byte-for-byte generated module placement ensures a SINGLE Compact/WASM runtime.
  // Importing directly from contracts/ loads its separate node_modules and fails WASM identity checks.
  await copyFile(new URL(name, original), new URL(name, source));
  const bytes = await readFile(new URL(name, original));
  const copy = await readFile(new URL(name, source));
  if (createHash('sha256').update(bytes).digest('hex') !== createHash('sha256').update(copy).digest('hex')) throw new Error('Generated module copy mismatch');
}
if (process.argv.includes('--dist')) {
  const dist = new URL('./dist/generated/contract/', import.meta.url);
  await mkdir(dist, { recursive: true });
  for (const name of ['index.js', 'index.d.ts']) await copyFile(new URL(name, original), new URL(name, dist));
}

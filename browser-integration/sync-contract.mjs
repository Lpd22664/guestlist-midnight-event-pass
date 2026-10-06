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
// Pin all public ZK artifacts to exactly the compiler output imported above.
const assetRoot = new URL('../contracts/generated/event-pass/', import.meta.url);
const publicRoot = new URL('./public/midnight/event-pass/', import.meta.url);
const files = [];
for (const circuit of ['issue', 'redeem', 'revoke']) {
  for (const path of [`keys/${circuit}.prover`, `keys/${circuit}.verifier`, `zkir/${circuit}.bzkir`]) {
    const bytes = await readFile(new URL(path, assetRoot));
    await mkdir(new URL(path.split('/')[0] + '/', publicRoot), { recursive: true });
    await copyFile(new URL(path, assetRoot), new URL(path, publicRoot));
    files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
const { writeFile } = await import('node:fs/promises');
const info = JSON.parse(await readFile(new URL('compiler/contract-info.json', assetRoot), 'utf8'));
const manifest = { schema: 'midnight-event-pass-assets-v1', runtime: info['runtime-version'], compiler: info['compiler-version'], contractSha256: createHash('sha256').update(await readFile(new URL('index.js', original))).digest('hex'), files };
await writeFile(new URL('./src/generated/asset-manifest.ts', import.meta.url), 'export const assetManifest = ' + JSON.stringify(manifest, null, 2) + ' as const;\n');
await writeFile(new URL('asset-manifest.json', publicRoot), JSON.stringify(manifest, null, 2) + '\n');

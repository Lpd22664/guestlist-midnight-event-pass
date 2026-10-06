import { mkdir, cp, copyFile } from 'node:fs/promises';
const root = new URL('./qa-mount/', import.meta.url);
await mkdir(new URL('qa/sdk/', root), { recursive: true });
await copyFile(new URL('./bundle/event-pass.js', import.meta.url), new URL('qa/sdk/event-pass.js', root));
await copyFile(new URL('./qa/smoke.html', import.meta.url), new URL('qa/index.html', root));
for (const name of ['smoke.js', 'smoke.css']) await copyFile(new URL('./qa/' + name, import.meta.url), new URL('qa/' + name, root));
await mkdir(new URL('midnight/', root), { recursive: true });
await cp(new URL('./public/midnight/event-pass/', import.meta.url), new URL('midnight/event-pass/', root), { recursive: true });
console.log('Staged static, zero-wallet-action smoke page at qa-mount/qa/index.html; copy qa-mount contents preserving relative paths');

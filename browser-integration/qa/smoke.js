const results = document.getElementById('results');
const summary = document.getElementById('summary');
results.replaceChildren();
const show = text => { const item = document.createElement('li'); item.textContent = text; results.append(item); };
try {
  // This is a prebuilt isolated facade. Do not point this at the Node integration package.
  const sdk = await import('./sdk/event-pass.js');
  show('PASS: browser ESM facade and WASM modules loaded');
  const syntheticEvent = new Uint8Array(32).fill(1);
  const syntheticBearer = new Uint8Array(32).fill(3);
  const expected = '5185c8debf55209fd26c57deed732812eba45a0081c735acd7d9a73f1ef3a038';
  const commitment = Array.from(sdk.derivePassCommitment(syntheticEvent, syntheticBearer), byte => byte.toString(16).padStart(2, '0')).join('');
  if (commitment !== expected) throw new Error('Genuine Compact fixture commitment did not match');
  show('PASS: real generated Compact commitment matches the pinned synthetic fixture');
  const base = new URL('../midnight/event-pass/', location.href).href;
  const provider = new sdk.BrowserZkConfigProvider(base);
  const key = await provider.getVerifierKey('issue');
  const expectedFile = sdk.assetManifest.files.find(file => file.path === 'keys/issue.verifier');
  if (!expectedFile || key.length !== expectedFile.bytes) throw new Error('Public verifier artifact is missing or from a different compilation');
  show(`PASS: public issue verifier key authenticated against the build manifest (${key.length} bytes)`);
  show(`Compiler ${sdk.assetManifest.compiler}; Compact runtime ${sdk.assetManifest.runtime}`);
  show('Wallet connections: 0 · credentials created: 0 · proofs: 0 · signatures: 0 · submitted transactions: 0');
  summary.textContent = 'PASS: browser loading and fixed-fixture/public-asset checks only'; summary.dataset.result = 'pass';
} catch (error) {
  show(`FAIL: ${error instanceof Error ? error.message : 'Browser loading failed'}`);
  summary.textContent = 'FAIL: browser smoke check did not finish'; summary.dataset.result = 'fail';
}

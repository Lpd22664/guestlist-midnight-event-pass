/** Validate current compiler artifacts against historical genuine proof inputs. No proving/network effects. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url), proofRoot = new URL('../proof-check/', import.meta.url);
const source = await readFile(new URL('contracts/event-pass.compact', root));
const build = JSON.parse(await readFile(new URL('contracts/evidence/build-manifest.json', root), 'utf8'));
const info = JSON.parse(await readFile(new URL('contracts/generated/event-pass/compiler/contract-info.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (build.compiler !== '0.31.1' || info['compiler-version'] !== '0.31.1' || build.runtime !== '0.16.0' || build.keyGeneration !== 'completed' || hash(source) !== build.sourceSha256) throw new Error('Current source/toolchain/full-build identity mismatch');
const provenance = JSON.parse(await readFile(new URL('evidence/provenance.json', proofRoot), 'utf8'));
const checks = [];
for (const [path, expected] of Object.entries(provenance.hashes)) {
  const actual = hash(await readFile(new URL(path, proofRoot)));
  if (actual !== expected) throw new Error(`Historical proof input/artifact hash mismatch: ${path}`);
  checks.push({ path, sha256: actual });
}
const comparison = JSON.parse(await readFile(new URL('contracts/evidence/compact-0311-comparison.json', root), 'utf8'));
for (const file of comparison.artifacts) {
  if (file.path.endsWith('.map')) continue; // Source-map paths change with isolated staging directories.
  if (hash(await readFile(new URL('contracts/generated/event-pass/' + file.path, root))) !== file.sha256) throw new Error('Supported compiler artifact differs from the inspected staging output');
}
const currentProofs = JSON.parse(await readFile(new URL('evidence/all-circuit-proof-result.json', proofRoot), 'utf8'));
if (currentProofs.compiler !== '0.31.1' || currentProofs.sourceSha256 !== hash(source) || currentProofs.transactionSubmitted !== false || currentProofs.networkFinalization !== false || currentProofs.circuits.length !== 3) throw new Error('Current local-proof report scope mismatch');
for (const circuit of ['issue', 'redeem', 'revoke']) {
  const entry = currentProofs.circuits.find(value => value.circuit === circuit);
  if (!entry || entry.cryptographicProverSelfVerification !== 'passed' || entry.witnessConstraints !== 'passed') throw new Error('Missing local circuit proof result');
  const file = `evidence/${circuit}-self-checked-0311.bin`;
  const proofBytes = await readFile(new URL(file, proofRoot));
  if (proofBytes.length !== entry.proofBytes || hash(proofBytes) !== entry.proofSha256) throw new Error('Current local proof bytes mismatch');
  checks.push({ path: file, sha256: entry.proofSha256 });
  for (const [name, path] of Object.entries({ proverKey: `keys/${circuit}.prover`, verifierKey: `keys/${circuit}.verifier`, ir: `zkir/${circuit}.bzkir` })) {
    if (hash(await readFile(new URL('contracts/generated/event-pass/' + path, root))) !== entry.artifacts[name]) throw new Error('Current local proof artifact mismatch');
  }
}
const report = { checkedAt: new Date().toISOString(), currentCompiler: info['compiler-version'], originalProofCompiler: provenance.compiler, sourceSha256: hash(source), checks, effect: 'hash checks only; no independent proof verification or network transaction' };
await writeFile(new URL('evidence/artifact-integrity.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: current full compiler identity and ${checks.length} historical proof input/artifact hashes`);

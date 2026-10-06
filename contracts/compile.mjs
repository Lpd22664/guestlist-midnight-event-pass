import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// No downloader, shell evaluation, wallet, node, credentials, or deployment.
// Install the official compiler yourself, then set COMPACTC to its binary or
// use the official compact CLI on PATH. This records what really ran.
const directory = fileURLToPath(new URL('.', import.meta.url));
const compilerVersion = '0.31.1';
const useBinary = Boolean(process.env.COMPACTC);
const command = process.env.COMPACTC || process.env.COMPACT || 'compact';
const base = useBinary ? [] : ['compile', `+${compilerVersion}`];
const run = (args) => spawnSync(command, [...base, ...args], {
  cwd: directory,
  encoding: 'utf8',
  env: process.env,
});
const version = run(['--version']);
if (version.error || version.status !== 0) {
  console.error(version.error?.message || version.stderr || 'Compiler unavailable');
  console.error(`Install the official Compact ${compilerVersion} toolchain; this command does not install it.`);
  process.exit(1);
}
const actualVersion = version.stdout.trim();
if (!/^0\.31\.1(?:\s|$)/.test(actualVersion)) {
  console.error(`Expected Compact ${compilerVersion}, got ${actualVersion}. Refusing mismatched compilation.`);
  process.exit(1);
}
const full = process.argv.includes('--full');
const output = 'generated/event-pass';
// Compile into an isolated directory. A failed full build must not erase a
// previous working logic build or leave empty key files looking deployable.
const stagingRoot = `.compiler-build-${process.pid}`;
const staging = `${stagingRoot}/event-pass`;
const args = [...(full ? [] : ['--skip-zk']), 'event-pass.compact', staging];
console.log(`Compact ${actualVersion}; ${full ? 'full key generation' : 'skip-zk logic build'}`);
const result = run(args);
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error || result.status !== 0) {
  if (result.error) console.error(result.error.message);
  mkdirSync(join(directory, 'evidence'), { recursive: true });
  writeFileSync(join(directory, 'evidence/last-failed-build.json'), `${JSON.stringify({
    attemptedAt: new Date().toISOString(), compiler: actualVersion,
    fullKeyGenerationRequested: full,
    status: 'failed', exitCode: result.status,
    error: result.error?.message || result.stderr,
  }, null, 2)}\n`);
  rmSync(join(directory, stagingRoot), { recursive: true, force: true });
  process.exit(result.status || 1);
}
const info = JSON.parse(readFileSync(join(directory, staging, 'compiler/contract-info.json')));
if (info['compiler-version'] !== compilerVersion || info['runtime-version'] !== '0.16.0') {
  throw new Error('Generated compiler metadata does not match the pinned toolchain');
}
if (full) {
  for (const circuit of info.circuits.filter((item) => item.proof)) {
    for (const suffix of ['prover', 'verifier']) {
      if (statSync(join(directory, staging, `keys/${circuit.name}.${suffix}`)).size === 0) {
        throw new Error(`Compiler emitted an empty ${suffix} key for ${circuit.name}`);
      }
    }
  }
}
mkdirSync(join(directory, 'generated'), { recursive: true });
const backup = join(directory, `${stagingRoot}/previous`);
if (existsSync(join(directory, output))) renameSync(join(directory, output), backup);
renameSync(join(directory, staging), join(directory, output));
rmSync(join(directory, stagingRoot), { recursive: true, force: true });
const source = readFileSync(join(directory, 'event-pass.compact'));
const manifest = {
  generatedAt: new Date().toISOString(),
  compiler: actualVersion,
  runtime: '0.16.0',
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  output,
  keyGeneration: full ? 'completed' : 'skipped',
  proofGeneration: 'not-run',
  proofVerification: 'not-run',
  networkDeployment: 'not-run',
  syntheticDataOnly: true,
};
mkdirSync(join(directory, 'evidence'), { recursive: true });
writeFileSync(join(directory, 'evidence/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated actual compiler outputs in ${output}`);

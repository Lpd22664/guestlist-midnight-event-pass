import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = readFileSync(new URL('../contracts/event-pass.compact', import.meta.url), 'utf8');
const command = process.env.COMPACTC || process.env.COMPACT || 'compact';
const base = process.env.COMPACTC ? [] : ['compile', '+0.31.1'];
const run = (args) => spawnSync(command, [...base, ...args], { encoding: 'utf8', env: process.env });

test('official pinned compiler is actually available', () => {
  const result = run(['--version']);
  assert.equal(result.error, undefined, 'Set COMPACTC to an installed official 0.31.1 compiler');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^0\.31\.1(?:\s|$)/);
});

const compile = (content) => {
  const directory = mkdtempSync(join(tmpdir(), 'event-pass-compiler-test-'));
  try {
    const file = join(directory, 'event-pass.compact');
    writeFileSync(file, content);
    return run(['--skip-zk', file, join(directory, 'output')]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('original source passes actual compiler type and disclosure checks', () => {
  const result = compile(source);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('compiler rejects a new circuit mutating the sealed event', () => {
  const result = compile(`${source}\nexport circuit overwriteEvent(id: Bytes<32>): [] { eventId = disclose(id); }\n`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sealed/i);
});

test('compiler rejects a new circuit mutating the sealed issuer authority', () => {
  const result = compile(`${source}\nexport circuit overwriteIssuer(id: Bytes<32>): [] { issuerCommitment = disclose(id); }\n`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sealed/i);
});

test('compiler rejects accidental raw bearer-secret disclosure', () => {
  const result = compile(`${source}\nexport circuit leakBearer(): Bytes<32> { return bearerSecret(); }\n`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /disclos|witness/i);
});

test('compiler rejects a dishonest pure annotation on a witness-reading circuit', () => {
  const result = compile(`${source}\nexport pure circuit fakePure(): Bytes<32> { return disclose(bearerSecret()); }\n`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pure|witness/i);
});

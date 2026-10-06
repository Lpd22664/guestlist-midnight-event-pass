/** Actual local cryptographic proof checks, fixed PUBLIC synthetic witnesses only. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as ZK from '@midnight-ntwrk/zkir-v2';
import * as Ledger from '../integration/node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js';
import { LocalContractHarness } from '../contracts/local-harness.mjs';
const paramsRoot = process.env.MIDNIGHT_PARAMS_DIR;
if (!paramsRoot) throw new Error('Supply the existing official public parameter cache explicitly');
const bytes = async path => new Uint8Array(await readFile(path));
const hash = value => createHash('sha256').update(value).digest('hex');
const assets = new URL('../contracts/generated/event-pass/', import.meta.url);
const info = JSON.parse(await readFile(new URL('compiler/contract-info.json', assets), 'utf8'));
const report = { checkedAt: new Date().toISOString(), compiler: info['compiler-version'], runtime: info['runtime-version'], sourceSha256: hash(await readFile(new URL('../contracts/event-pass.compact', import.meta.url))), syntheticWitnesses: 'fixed public testBytes(1/2/3)', circuits: [], independentLedgerCryptographicVerification: false, transactionSubmitted: false, walletActions: 0, networkFinalization: false };
for (const circuit of ['issue', 'redeem', 'revoke']) {
  const material = { proverKey: await bytes(new URL(`keys/${circuit}.prover`, assets)), verifierKey: await bytes(new URL(`keys/${circuit}.verifier`, assets)), ir: await bytes(new URL(`zkir/${circuit}.bzkir`, assets)) };
  const k = ZK.Zkir.deserialize(material.ir).getK();
  const params = await bytes(`${paramsRoot}/bls_midnight_2p${k}`);
  const provider = { lookupKey: async name => { assert.equal(name, circuit); return material; }, getParams: async requestedK => { assert.equal(requestedK, k); return params; } };
  const harness = new LocalContractHarness();
  if (circuit !== 'issue') harness.call('issue', harness.commitment());
  const { proofData: d } = harness.call(circuit, harness.commitment());
  const preimage = Ledger.proofDataIntoSerializedPreimage(d.input, d.output, d.publicTranscript, d.privateTranscriptOutputs, circuit);
  await ZK.check(preimage, provider);
  const started = Date.now(); console.log(`Actual ${circuit} proof and mandatory prover cryptographic self-verification started`);
  const proof = await ZK.prove(preimage, provider, 0n);
  assert.ok(proof instanceof Uint8Array && proof.length > 0);
  const entry = { circuit, proofBytes: proof.length, elapsedMs: Date.now() - started, k, witnessConstraints: 'passed', cryptographicProverSelfVerification: 'passed', proofSha256: hash(proof), paramsSha256: hash(params), artifacts: Object.fromEntries(Object.entries(material).map(([name, value]) => [name, hash(value)])) };
  await writeFile(new URL(`evidence/${circuit}-self-checked-0311.bin`, import.meta.url), proof);
  report.circuits.push(entry);
  await writeFile(new URL('evidence/all-circuit-proof-result.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(entry));
}
console.log('PASS: all three real local proofs returned after mandatory cryptographic prover self-check; no wallet/network/finality evidence');

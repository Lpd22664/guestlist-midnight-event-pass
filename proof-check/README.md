# Real local synthetic proof check

This isolated check uses the original event-pass Compact contract and the
official WASM prover. Actual proof generation succeeded, including the prover's
mandatory cryptographic self-verification. No wallet, funds, Docker, node,
indexer, deployment, or network submission was used.

## Important verification distinction

The official `zkir-v2.prove` implementation calls `ProofPreimage.prove`, which
creates the proof and calls `verifier_key.verify` against the public parameters
before returning it. An error in that check prevents the proof from returning.
This real prover successfully returned a 4,501-byte issue proof. A later supported 0.31.1 run returned issue, redeem and revoke proofs, each 4,501 bytes, after witness constraints and mandatory cryptographic self-checks. See `evidence/all-circuit-proof-result.json` and its output log.

A separate `ledger-v8.wellFormed` check returned `VerifiedTransaction` with
`verifyContractProofs=true`. **That is not independent cryptographic evidence
in this npm WASM build.** A byte mutation within the proof was also accepted.
The upstream ledger-wasm package disables ledger default features, and the
contract proof verifier is explicitly a no-op when `proof-verifying` is absent.
The saved ledger pass is therefore recorded as a structural check only.

The supplied negative control passes the correct issue proving key and IR with
a deliberately mismatched revoke verifier key to the official prover. It must
fail with `Invalid proof`, demonstrating that the prover's own cryptographic
self-verification rejects that mismatch. It is distinct from a witness check.

## Scope

- Existing predictable `testBytes(1/2/3)` event, issuer, and bearer fixtures only
- Fixed communication randomness is public test material
- Original contract, generated artifacts, frontend, and integration are read-only
- An in-memory synthetic ledger fixture supplies the original verifier keys
- Native-proof, signature, and size-limit flags are enabled; fee balancing is disabled for this deliberately unfunded local fixture
- No owner credentials, wallet account, funds, network submission, or finalization
- Does not establish network compatibility, fees, funding, finalization, or real admission

Proof bytes vary across runs because cryptographic proof generation uses fresh
mathematical randomness. That randomness is not a user credential.

## Tested pins

- Original generated contract: Compact 0.31.0, runtime 0.16.0, ZKIR v2, k=13
- `@midnight-ntwrk/zkir-v2` 2.1.0, pinned by this directory's package lock
- `@midnight-ntwrk/ledger-v8` 8.1.0 from the existing Midnight.js 4.1.1 integration
- Node 24.19.0
- Original compiler-generated proving/verifier keys
- Existing public SRS `bls_midnight_2p13`

The later full Compact 0.31.1 compilation produces byte-identical JS/types, keys and ZKIR. `contracts/evidence/compact-0311-comparison.json` records every comparison; this does not retroactively change the historical proof run's 0.31.0 provenance.

## Reproduce

From the repository root:

```sh
npm ci --prefix contracts --ignore-scripts
npm ci --prefix integration --ignore-scripts
npm ci --prefix proof-check --ignore-scripts
cd proof-check
MIDNIGHT_PARAMS_DIR=/path/to/public/zk-params \
  RAYON_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  node --max-old-space-size=2048 prepare-local-transaction.mjs \
  > evidence/transaction-proof-output.txt 2>&1
node verify-saved-transaction.mjs > evidence/saved-verification-output.txt 2>&1
MIDNIGHT_PARAMS_DIR=/path/to/public/zk-params \
  RAYON_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  node --max-old-space-size=2048 check-mismatched-verifier.mjs \
  > evidence/mismatched-verifier-output.txt 2>&1
```

`MIDNIGHT_PARAMS_DIR` must contain the official public `bls_midnight_2p13`
parameter file. This build reused the compiler's existing cache at
`/tmp/midnight-zkir-cache/midnight/zk-params`. The scripts do not fetch data,
change network configuration, or silently substitute parameters. The official
compiler's full compilation workflow prepares these public parameters.

WASM proof work is serialized in one Node thread. The full issue proofs took
about 32 seconds each here. Only files under this directory were added.

## Evidence

- `evidence/provenance.json`: exact inputs and artifact hashes
- `evidence/circuit-proof-output.txt`: standalone real issue proof output
- `evidence/proof-result.json`: standalone proof length, hash, and timing
- `evidence/transaction-proof-output.txt`: real bound issue proof and structural ledger check
- `evidence/transaction-proof-result.json`: validation flags and explicit verification caveat
- `evidence/synthetic-issue-transaction-proof.bin`: actual proof bytes
- `evidence/synthetic-proven-transaction.bin`: locally bound synthetic transaction
- `evidence/local-reference-ledger.bin`: synthetic ledger fixture
- `evidence/saved-verification-output.txt`: fresh-process structural/tamper diagnostic
- `evidence/tamper-verification-result.json`: records accepted mutation, not a cryptographic pass
- `evidence/mismatched-verifier-output.txt` and `mismatched-verifier-result.json`: prover cryptographic negative control

The historical transaction run output used the word cryptographic for the
ledger pass before the negative control uncovered the build limitation. That
interpretation is superseded by the explicit caveat in this README and JSON
results. The actual prover self-verification remains a cryptographic check.

## Official sources

- [Local proving and native/WASM alternatives](https://docs.midnight.network/guides/local-proving)
- [Official WASM proving package](https://github.com/midnightntwrk/midnight-ledger/tree/ledger-8/zkir-wasm)
- [WASM prove/check API](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/zkir-wasm/zkir-v2.d.ts)
- [WASM prove implementation](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/zkir-wasm/src/lib.rs)
- [Mandatory prover self-verification](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/transient-crypto/src/proofs.rs)
- [Ledger WASM disabled default features](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/ledger-wasm/Cargo.toml)
- [Feature-gated contract proof verifier](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8/ledger/src/structure.rs)
- [Current support matrix](https://docs.midnight.network/relnotes/support-matrix)

## Reproduce all three current circuit proofs

With the same existing official public parameter cache and pinned dependencies, run from this directory:

```sh
MIDNIGHT_PARAMS_DIR=/path/to/public/zk-params RAYON_NUM_THREADS=1 \
  node --max-old-space-size=2048 prove-all-circuits.mjs
```

The script uses fixed public event/issuer/bearer fixtures, one circuit at a time. Redeem/revoke ACTIVE prestates come from actual generated issue execution, locally only. Each result records source, key/IR/parameter/proof hashes and elapsed time. It does not establish a wallet signature, fee balancing, independent ledger cryptographic verification, chain acceptance or physical admission.

# Original Compact event-pass contract

Synthetic-data portfolio prototype. This directory contains original Compact
source and real compiler-generated artifacts. It is **not deployed**. The UI's
browser simulator is a separate demonstration and must never report a simulated
operation as a Midnight transaction, proof, or finalized admission.

## Exact tested toolchain

- Compact compiler **0.31.1**, Compact language **0.23.0**
- `@midnight-ntwrk/compact-runtime` **0.16.0**
- `@midnight-ntwrk/onchain-runtime-v3` **3.0.0**, enforced by npm override
- Exact npm package versions and registry integrity hashes in `package-lock.json`
- Node.js **24.19.0** in the build environment; package requires Node 22+

Official sources checked 2026-10-05:

- [Current support matrix](https://docs.midnight.network/relnotes/support-matrix)
  recommends compiler **0.31.1**, runtime 0.16.0, on-chain runtime 3.0.0,
  Midnight.js/testkit 4.1.1, DApp Connector 4.0.1, and proof-server 8.1.0
- [Compiler 0.31.1 release](https://github.com/midnightntwrk/compact/releases/tag/compactc-v0.31.1)
  pairs with runtime 0.16.0 and ledger 8; this is the compiler actually tested
- [Compiler 0.35.0 release](https://github.com/midnightntwrk/compact/releases/tag/compactc-v0.35.0)
  targets ledger 9 and advises 0.31.x for current mainnet. Do not blindly upgrade
- [JavaScript runtime guide](https://docs.midnight.network/guides/compact-javascript-runtime)
  explains why generated-runtime tests do not establish proof or chain validity

Full compilation with the current supported **0.31.1** completed on 5 October 2026. The official Linux release asset checksum matched GitHub metadata:

`e291b4bab4d4e857707008f8b1c25c2b8e0c843f6c737d0ee6c0d9ac69a6bbfb`

All generated JS/types, circuit keys and ZKIR are byte-identical to the earlier 0.31.0 compilation. Compiler metadata and source-map paths differ. The comparison is recorded in `evidence/compact-0311-comparison.json`. The existing local proof's earlier compiler provenance remains preserved and its source/key/IR hashes still match; a supported compile does not establish network deployment or finality.

## Run

From this directory:

```sh
npm ci --ignore-scripts
npm test
```

`npm test` runs the **actual generated contract** with the official runtime. It
requires neither compiler installation nor a wallet, node, indexer, or proof
server. No mocked contract state machine substitutes for the compiled source.

With official Compact 0.31.1 installed:

```sh
compact update 0.31.1
npm run compile
npm run compile:full
npm run test:compiler
```

An extracted official binary can be selected with `COMPACTC=/absolute/path/to/compactc`.
`COMPACT` may select an official Compact CLI path. The build script verifies the
compiler version, stages output, checks metadata and nonempty keys, then swaps
successful artifacts in place. It does not download anything or deploy.

In a restricted filesystem, use a writable build-only cache:

```sh
mkdir -p /tmp/event-pass-build-home /tmp/event-pass-build-cache
HOME=/tmp/event-pass-build-home XDG_CACHE_HOME=/tmp/event-pass-build-cache \
  COMPACTC=/absolute/path/to/compactc npm run compile:full
```

Changing the build cache does not change any security or network settings.
Official installation guidance is at the
[Compact repository](https://github.com/LFDT-Minokawa/compact).

## Public and private data

Public ledger:

- Sealed `eventId` and `issuerCommitment`
- Permanent `passes: Map<Bytes<32>, PassStatus>`
- `issuedCount`, `redeemedCount`, `revokedCount`

Private inputs: local `issuerSecret` and `bearerSecret` witnesses. The constructor
uses the initial issuer secret to derive the authority commitment. These are
dedicated app credentials, not wallet authentication or wallet seed phrases.

Both commitments use exact Compact runtime serialization and
`persistentHash<Vector<3, Bytes<32>>>` over:

1. A 32-byte padded domain, `midnight:event-pass:issuer:v1` or
   `midnight:event-pass:bearer:v1`
2. The event ID
3. A 32-byte credential secret

Use the generated `pureCircuits.deriveIssuerCommitment` and
`pureCircuits.derivePassCommitment` functions. Do not substitute an unverified
browser SHA-256 encoding. Every deployment needs a new unique random event ID;
every issuer credential and bearer credential needs independently generated
cryptographically secure random bytes. Tests intentionally use predictable
values that must never become real credentials.

## Rules

- Only knowledge of the issuer secret can issue or revoke
- A commitment can be issued once, including after use or revocation
- Only knowledge of the correct bearer secret can redeem
- Redemption checks ACTIVE and writes USED in one circuit
- Revocation changes ACTIVE to REVOKED
- USED and REVOKED have no outgoing transitions
- Unknown, malformed, zero, wrong-secret, repeated, and cross-event redemption
  attempts are rejected

Only a **finalized accepted network state update** permits a real gate to admit
someone. Two local calls built from the same stale ACTIVE state can both succeed
off-chain; the suite explicitly demonstrates this. A real concurrency test
requires a network and transaction finalization.

## Privacy and bearer limitations

The raw secret is absent from the public ledger. A public commitment, its issue,
redemption/revocation status, counts, contract/event, timing, and surrounding
transaction metadata remain linkable. This is not anonymous attendance.

A QR carrying the secret is a bearer credential: anyone who copies it can
redeem it. A scanner sees the secret; proof-server handling and private-state
storage need a separate security review. Screenshots, exports, logs, clipboard,
URLs, analytics, and browser storage can leak it. This prototype does not
establish physical presence, scanner authorization, named-attendee identity,
or nontransferability. Bearers can also consume a pass remotely. Issuers may
revoke an ACTIVE pass. Losing the sole sealed issuer credential prevents future
issue/revoke; this contract has no authority recovery/rotation operation.

## Evidence and remaining integration

`evidence/build-manifest.json` ties the actual compiler output to a source hash.
`evidence/runtime-test-output.txt`, `compiler-test-output.txt`, and
`full-compile-output.txt` preserve real command results. Generated keys are public
proving/verifier artifacts and contain no attendee or issuer secret.

Not run: a proof-server proof, proof verification, wallet authorization, DUST
pricing/funding, transaction submission, network finalization, or real
simultaneous scanners. No network contract address exists.

For an authorized test-network adapter:

1. Reconfirm the current network's supported toolchain and recompile
2. Configure local proof server, indexer/public-state, encrypted private-state,
   ZK file assets, wallet and submit providers
3. Attach generated `Contract` and witness implementations to a `CompiledContract`
4. Deploy only when explicitly authorized and retain the returned address
5. Subscribe to confirmed public state; prepare `callTx.issue/revoke/redeem`
   with the proper local witness inputs
6. Display preparation, user wallet authorization, submission, confirmation,
   rejection and retry states separately; reread confirmed status after conflict
7. Admit only once after finalized acceptance, never after a local green check

See [deployment guide](https://docs.midnight.network/guides/deploy-and-operate),
[networks](https://docs.midnight.network/guides/networks-and-environments), and
[security guidance](https://docs.midnight.network/guides/security-best-practices).

## Later local cryptographic checkpoint

The compile manifest above records its earlier build stage. A later independent proof-check/ package generated a genuine local issue proof using the official ZKIR-v2 WASM prover and ran a separate ledger check of a bound synthetic in-memory issue transaction. That check returned VerifiedTransaction with verification flags enabled but initially accepted a mutated proof byte, so independent cryptographic verification is not established. The official prover performs built-in self-verification. Fee balancing was disabled for the unfunded fixture. See ../proof-check/README.md and its evidence. This does not establish a deployed contract, network finality, or redeem/revoke proof coverage.

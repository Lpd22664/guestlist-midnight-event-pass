# Guestlist architecture

This document separates the React and TypeScript application, local synthetic demonstration, and Compact contract. The source details below were inspected on 5 October 2026. **The future Midnight integration and operational controls are provisional.** Contract source and generated artifacts remain authoritative; source inspection does not establish successful compilation, proof generation, or network deployment.

## Two execution modes

### Local synthetic demonstration

The UI demonstrates issuance, attendee credentials, redemption, revocation, and failure handling with invented data. Its local state is an educational simulator. A local status change is not a Midnight transaction, and a visual proof or transaction indicator is not evidence that a zero-knowledge proof was generated. The word "preview" in the demo means an interactive product preview, not a verified connection to Midnight Preview.

The demo uses `src/domain.ts` and `src/demo-service.ts`. It does not call a wallet, indexer, or proof server. Its commitment is browser SHA-256 over `guestlist:demo:v1:<eventId>:<secret>`; its credential is a `guestlist-demo:` prefix followed by base64-encoded JSON with version, demo mode, eventId, passId, and secret. Base64 is an encoding, not encryption. Neither format is a Compact network credential.

Invented seed passes use deliberately predictable public fixture secrets; newly issued demo passes use `crypto.getRandomValues`. Both are synthetic. State, labels, and credentials are saved in browser localStorage, with in-memory fallback on a storage failure. The service queues local actions and uses Web Locks when available. This is not distributed admission consensus, and browser storage is inspectable and editable by its owner.

The UI adds expiry, a 72-pass limit, Guest/Host presentation labels, and local request idempotency. The current Compact contract does not enforce these features. A Host label grants no additional contract authority; expiry in the simulator is a client-clock check, not an on-chain time gate.

### Midnight integration target

A real adapter would connect generated Compact code to compatible Midnight.js providers, a wallet, proving artifacts, a local or explicitly trusted proof server, and a public-data provider. It must distinguish preparation, proving, submission, finalisation, rejection, and uncertain outcome. The UI must only describe a pass as admitted after the authoritative state transition is confirmed.

Midnight's official flow executes the circuit locally, proves it, balances and submits the transaction, then observes finalisation. Full compilation must include proving artifacts, not only generated JavaScript. [Deploying and operating a contract](https://docs.midnight.network/guides/deploy-and-operate), checked 5 October 2026.

## Data boundaries

| Data | Intended location | Who can see it |
| --- | --- | --- |
| Event identifier and issuer commitment | Public ledger in a deployed version | Chain observers |
| Pass commitment and active/redeemed/revoked state | Public ledger in a deployed version | Chain observers; actions are linkable |
| Issuance, redemption, and revocation counters | Public ledger in a deployed version | Chain observers |
| Issuer secret | Issuer's local private state | Issuer device and trusted proving infrastructure |
| Bearer pass secret | Attendee credential; gate memory during presentation | Credential holder, scanner, and trusted proving infrastructure |
| Name, email, and contact-to-pass mapping | Off-chain organiser record | Organiser and whoever has authorised access to that record |
| Demo records and credentials | Local demo memory/storage | Anyone with access to that browser profile |

"Off-chain" describes location, not access control. The organiser can correlate contacts and commitments. A scanner that receives the bearer secret can copy it. Public timing, circuit names, contract address, and ledger map operations create further observable context.

## Compact source and commitment flow

`contracts/event-pass.compact` defines `PassStatus { ACTIVE, USED, REVOKED }`, the `eventId` and `issuerCommitment` ledger fields, `passes: Map<Bytes<32>, PassStatus>`, and `issuedCount`, `redeemedCount`, and `revokedCount` counters. No map entry means never issued. Existing entries are never removed, so used and revoked commitments cannot be reissued.

The constructor accepts a 32-byte event ID and issuer secret, rejects all-zero values, and publishes the event ID and derived issuer commitment. Use a fresh unique random event ID per deployment and independently generated secrets. Both `eventId` and `issuerCommitment` are declared `sealed`, so the source fixes them at construction and supplies no rotation path.

Both derivations use `persistentHash<Vector<3, Bytes<32>>>`, with this ordered tuple:

- Issuer: `[pad(32, "midnight:event-pass:issuer:v1"), eventId, issuerSecret]`
- Pass: `[pad(32, "midnight:event-pass:bearer:v1"), eventId, bearerSecret]`

Use the generated runtime's typed derivation helpers for interoperability. The tuple's runtime serialization is not interchangeable with the demo's string hashing. The official runtime describes `persistentHash` as appropriate for state derivation and stable across upgrades except devnet. [Runtime reference](https://docs.midnight.network/api-reference/compact-runtime/functions/persistentHash), checked 5 October 2026.

The source exposes the pure helpers `deriveIssuerCommitment` and `derivePassCommitment`, and these lifecycle circuits:

1. `issue(commitment)` checks the `issuerSecret` witness against `issuerCommitment`, rejects zero or already present commitments, inserts ACTIVE, and increments issuedCount
2. `redeem(commitment)` checks the nonzero `bearerSecret` witness against the event-bound pass commitment, asserts membership and ACTIVE, sets USED, and increments redeemedCount
3. `revoke(commitment)` checks issuer authority, asserts membership and ACTIVE, sets REVOKED, and increments revokedCount

Redemption is bearer-only. An issuer witness is not required, so a holder can consume their pass remotely. This proves possession and eligibility, not physical admission or gate authority. Issuance accepts an organiser-supplied commitment; the issuer's off-chain process is responsible for generating and delivering a usable, high-entropy bearer credential.

The term "commitment" here refers to a digest of a high-entropy secret. It is not a claim that hashing a name or email hides it, or that this uses the standard library's randomised `persistentCommit` primitive.

## State invariants

- Only an authorised issuer can create or revoke a pass
- The same commitment cannot be issued twice
- Only an active, known pass can be redeemed or revoked
- Redemption and revocation are irreversible within this scope
- Concurrent attempts must resolve against authoritative ledger state; a UI check alone cannot enforce one-use admission
- Rejected actions do not update admission status or counters

Because redemption is bearer-only, anyone holding the credential can consume it remotely. Requiring both gate authority and the bearer secret is a possible future physical-check-in policy, not a control present in this contract.

## Recorded contract validation

The existing [full compilation log](../contracts/evidence/full-compile-output.txt) records Compact 0.31.1 with key generation completed. Prover/verifier keys and ZKIR exist for issue, redeem, and revoke. The [runtime log](../contracts/evidence/runtime-test-output.txt) records 19 passing generated-contract tests; the [compiler log](../contracts/evidence/compiler-test-output.txt) records six passing compiler checks, including negative disclosure and sealed-field cases. The [build manifest](../contracts/evidence/build-manifest.json) matches the inspected source hash.

This is local compilation and runtime evidence. Proof generation, proof verification, wallet/provider integration, Preview deployment, network finality, and concurrent-scanner consensus remain unverified. The [QA checklist](qa-checklist.md) separates these stages and records the actual toolchain pins.

## Trust and operational gaps

Witness implementations are untrusted inputs to circuit logic, so the circuit must constrain every security-relevant claim. A wallet connection or organiser tab does not itself establish issuer authority. [Smart contract security](https://docs.midnight.network/compact/smart-contract-security), checked 5 October 2026.

The proof service, off-chain contact store, frontend delivery, recovery policy, key rotation, and maintenance authority are distinct trust decisions. Before a pilot, reconcile this document with source, publish exact supported toolchain versions, test adversarial calls, and verify transaction finalisation on the selected network.

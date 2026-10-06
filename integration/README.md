# RETIRED: Node live adapter

This package is historical research only. Independent stress testing found that its receipt verification could misattribute an unrelated successful transaction to a pass transition, and its async wallet/role guards diverged from the hardened browser boundary. Constructor, receipt verification and wallet-provider entry points now **fail closed before side effects**. Use [`../browser-integration/README.md`](../browser-integration/README.md) for the supported implementation. The earlier 23-test result below is historical evidence, not a current live-readiness claim. `npm test` now tests retirement guards; the old suite is retained for inspection only.

---

# Real Midnight.js integration adapter

This standalone package implements the original Compact event-pass contract's actual SDK boundary. It is **not connected to the portfolio UI**, and it does not make the UI's synthetic SHA-256 commitments compatible with Compact. Network deployment and valid proof generation/verification have **not run**.

## Verified locally

- Exact dependencies: Midnight.js provider/contracts/types/protocol packages **4.1.1**, DApp Connector API **4.0.1**, Compact runtime **0.16.0**, on-chain runtime **3.0.0**
- Strict TypeScript application typecheck and build
- **23 offline tests**: real generated commitment derivation/witnesses, ledger transitions, complete execution status, independent finalized-block state checks, public receipt redaction, rejected authorization, a real SDK deploy-construction path stopped at a delayed mock prover, timeout guards, duplicate request rejection, wallet selection, read-only RPC and claim-once admission
- No real prover, wallet connection/balance/signing, node submission, physical gate, or network consensus was exercised

Run from this directory after compiling the contract fully:

```sh
npm ci
npm run verify
```

`sync-contract.mjs` stages the original compiler-generated JS and declaration module byte-for-byte inside this package. This is necessary in Node: importing it directly from the sibling `contracts/` package loads a second WASM runtime and causes actual SDK construction to reject objects from the other runtime. Staged files and `dist/` are build products, not hand-edited contract code; keys/ZKIR still come from the original full compile assets directory. Synchronization checks matching SHA-256 bytes.

`skipLibCheck` is enabled because the published Compact JS 2.5.1 declaration file refers to missing internal `Variance`, `TypeId` and `Context` exports, and a provider declaration has an `isomorphic-ws` interoperability issue. Application source is strictly checked against the official exported APIs with explicit contract generics; dependency declarations are not claimed clean. No `any` stubs replace SDK APIs.

## Modules

- `src/contract.ts`: genuine generated Compact pure-circuit commitment helpers and private witnesses; issuer/bearer secrets are explicit and may be absent according to the owner's role
- `src/providers.ts`: owner-configured node providers, test-network restriction, global network-ID checks and read-only public-data provider
- `src/wallet.ts`: UUID-based wallet injection discovery, owner-selected/API-4 wallet connection, network validation, actual connector balance/submit bridge, Bech32m public-key decoding
- `src/adapter.ts`: `join`, `deploy`, `issue`, `redeem`, `revoke`, read-only `reconcile`
- `src/receipts.ts`: public-only receipts requiring `SucceedEntirely`, successful segments and independent contract state queried at the finalized block hash
- `src/admission.ts`: reconstruct a redemption receipt from a trusted provider and claim admission once through a durable shared gate store
- `src/chain-status.ts`: read-only `system_version`, `chain_getFinalizedHead` and `chain_getHeader`, with a bounded abort timeout
- `src/journal.ts`: durable owner-managed operation-journal contract and fail-closed timeout errors

Imports are available from `dist/index.js` after build. Node 22+ is required. This package is a Node-oriented integration boundary; a browser application needs a browser ZK-asset provider and compatible bundling, plus owner-reviewed private storage, before UI integration.

## Owner configuration and authorization

The adapter supplies **no default wallet, password, account identifier, secret, maintenance key, proof-server URI or service endpoint**. Before using it, the host must supply:

1. Correct test-network providers and the full generated contract assets directory
2. An owner/account/event-scoped private-state provider and explicit `privateStateId`; never a shared gate database containing every attendee's secrets
3. A durable account-scoped `AttemptJournal`. `create` must atomically reject duplicate request IDs and unresolved attempts for the same event across processes/restarts. `update` must persist atomically. Test-only in-memory fixtures do not satisfy this requirement
4. A real owner-approval callback. It receives action, network, public target/event/commitment, trusted proof destination, private-state/key persistence and DUST consequences. Do not implement it as unconditional approval
5. An existing owner-controlled maintenance signing key for deploy/join. Both SDK entry points otherwise automatically create one; this adapter requires one explicitly to avoid that behavior. Secure key input/provisioning remains the owner's responsibility
6. For physical entry, an owner-managed `AdmissionStore` whose `claimOnce` atomically enforces network/contract/commitment uniqueness across all gates and restarts

Wallet connection is separate owner-authorized setup. The bridge accepts an already connected wallet or the owner explicitly chooses a wallet and approves `connectOwnerSelectedWallet`. It does not create a wallet, generate a seed, establish grants on its own, or sign a network operation during construction.

A trusted prover receives private proof preimages/witness material. The `proofDestination` passed to the adapter must accurately identify the configured prover for approval. Do not send real issuer/bearer capabilities to an arbitrary hosted prover.

## Confirmation, unknown outcomes and replay

SDK circuit submission has local execution, proving, wallet fee balancing and submission, followed by indexer finalization. A transaction identifier or pending/confirmed state is insufficient for admission. `FailEntirely`, `FailFallible`, any failed segment, wrong event/issuer, missing or stale state are rejected.

Every submission is journaled before the external send, including the finalized transaction's candidate identifiers. The watchdog revokes permission to begin later balance/submission stages after timeout. It cannot cancel a wallet prompt, prover request or external submission already in progress; timeout means **unknown**, never success and never permission to blindly rebuild/resubmit. In-flight work stays locked within the adapter. Late successful outcomes may be recorded for read-only reconciliation.

`reconcile(requestId)` watches the existing ID and rechecks finalized-block state only. If a deployment was submitted but its address was not captured before process interruption, recover its **public** address from that transaction through the explorer/indexer and pass it as `reconcile(requestId, recoveredDeploymentAddress)`. The adapter checks the event and issuer before accepting it. Never repeat deployment to recover an unknown outcome. If no identifier is available, investigation is required; `null` means unresolved.

A reusable receipt itself must not reopen a gate. `verifyAndClaimAdmission` checks a matching journaled redemption against the trusted provider, then claims the event pass once in the durable shared admission store. Reusing the same or a different request ID for the same pass returns `admit: false` after the first claim. Any network/storage error fails closed.

SDK failures can contain private transactions and keys. This package redacts provider errors and extracts only named public receipt fields. Never log or serialize an SDK transaction result's `private` field, proof preimages, `unprovenTx`, private states or signing keys.

## Genuine Preview / Preprod deployment prerequisites

The [official current support matrix](https://docs.midnight.network/relnotes/support-matrix) was checked on 2026-10-05. It lists the tested compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, connector **4.0.1**, ledger **8.1.0** and proof server **8.1.0**. The existing contract artifacts were compiled with **0.31.0**. They share the runtime and pass offline tests, but are outside the latest-tested compiler row. Recompile with **0.31.1**, regenerate all circuit keys and rerun the contract/adapter checks before claiming current supported network compatibility.

The [official deployment guide](https://docs.midnight.network/guides/deploy-and-operate) requires full `contract/`, `keys/` and `zkir/` artifacts, network providers and an owner wallet with test NIGHT registered for DUST generation and enough DUST for fees. The host must also provide safe owner-controlled private storage and maintenance authority setup. Only synthetic attendee/event fixtures should be used during initial tests.

The [official endpoint reference](https://docs.midnight.network/relnotes/network) lists Preview/Preprod RPC, indexer, faucet and explorers, but does **not** supply a public proof-server endpoint. The [proof-server guide](https://docs.midnight.network/guides/run-proof-server) recommends a local prover or an encrypted connection to an owner-controlled remote prover because private data is sent to it. Its documented Docker image uses the support-matrix tag, **8.1.0**, normally on port **6300**. No guessed public prover is configured here. If Docker is unavailable, an owner-controlled compatible native/remote prover is still needed; this adapter does not install one.

After these prerequisites and owner authorization, the remaining acceptance run is: deploy on the chosen test network, save a public deployment receipt/address, join with the verified event/issuer, issue a synthetic pass, redeem and admit once, reject a second gate attempt, issue/revoke another pass and reject redemption. Capture finalized successful receipts plus independent state reads. Until that run completes, describe the result as an implemented/typechecked SDK adapter with offline evidence, **not a deployed or end-to-end-tested DApp**.

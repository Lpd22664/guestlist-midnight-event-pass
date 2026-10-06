# Genuine Midnight browser integration boundary

This package implements the actual original Compact event-pass contract's browser SDK boundary. **Guestlist now wires this package in its separately selected Midnight Preview mode. Local demo still runs isolated `DemoService` by default.** This build environment did not handle owner keys or perform owner wallet grants/signatures or submit network transactions. Owner-reported setup and independently read public-node evidence are recorded in the root QA checklist; accepted contract deployment/lifecycle evidence remains pending.

## Verified state

- Strict application TypeScript, generated-contract build, and **59 offline tests** pass after workspace recovery
- The actual browser-conditioned ESM/WASM production bundle builds, and a Node smoke test imports that bundle without global `Buffer` or `process`, derives the genuine Compact commitment, and decodes synthetic API-4 public keys
- Tests use the actual generated contract, SDK constructor/verifier compatibility checks, and synthetic wallet/prover/public-data fixtures; encrypted IndexedDB tests use fake-indexeddb
- Native Chromium execution is blocked in this executor: its process singleton Unix socket is denied, and the supported escalation fails before launch on a synthetic `/root/.codex` mount. The Node bundle smoke is **not browser QA**
- `qa/` is a zero-action static browser loading check for an already authorized private browser/preview. Its ESM/WASM import, genuine commitment and authenticated public verifier key passed actual supported cloud Chrome at sources 07bbaa03 and 1edf2dfc (5 October 2026). This is public build-asset QA only
- Neither a built adapter nor a local valid proof establishes network finality. Ledger WASM structural verification alone is not cryptographic proof verification

Exact direct SDK packages are pinned: Midnight.js **4.1.1**, connector **4.0.1**, address format **3.1.2**, Compact runtime **0.16.0**. Overrides force ledger **8.1.0** and onchain runtime **3.0.0**. The generated artifacts report compiler **0.31.1**, language **0.23.0**. The supported full 0.31.1 compile and negative/runtime tests passed. All JS/types/keys/ZKIR match the historical 0.31.0 local-proof inputs; matching versions and local tests do not establish network acceptance.

```sh
cd browser-integration
npm ci --ignore-scripts --cache /tmp/guestlist-recovery-npm
npm run verify:offline
npm run stage:qa
# On a machine with a permitted isolated Chromium launcher:
npm run test:browser
```

`npm run verify` includes the real Chromium harness and therefore remains blocked here. Dependency declarations use `skipLibCheck` for the published Compact JS declaration issues documented in the Node adapter; application code is strictly checked against the real SDK types with no `any` factory stubs.

## Browser mounting and runtime identity

`sync-contract.mjs` copies generated `contract/index.js` and its declaration **byte-for-byte** from `../contracts/generated/event-pass`. It stages the `.prover`, `.verifier`, and `.bzkir` files and creates a manifest with exact size/SHA-256 and the generated module's hash. `BrowserZkConfigProvider` extends the genuine SDK `FetchZkConfigProvider`, restricts fetches to this artifact set, uses existing same-origin app cookies only for its own protected artifact origin, omits credentials to external origins, rejects redirects, and checks every fetched file's integrity before returning it. The original generated source, verifier keys and proving keys must come from one complete compile.

After `npm run stage:qa`, copy the **contents** of `qa-mount/` to a static root, keeping this layout:

```text
/qa/index.html
/qa/smoke.js
/qa/smoke.css
/qa/sdk/event-pass.js
/midnight/event-pass/asset-manifest.json
/midnight/event-pass/keys/issue.prover
/midnight/event-pass/keys/issue.verifier
/midnight/event-pass/zkir/issue.bzkir
# equivalent keys/zkir files for redeem and revoke
```

Open `/qa/` on that same origin. It imports the production bundle, compares a fixed synthetic commitment with `5185c8debf55209fd26c57deed732812eba45a0081c735acd7d9a73f1ef3a038`, and authenticates the public issue verifier key. It never accesses `window.midnight`, storage, credential generation, proving, signing or submission. Its on-screen pass means **browser module/WASM/public-artifact loading only**. The page must be on HTTPS or loopback HTTP, not `file:`. A root-level mount is assumed; for a subpath, change the harness's artifact URL explicitly.

For the actual app, dynamically import the prebuilt `bundle/event-pass.js` as one isolated SDK boundary and supply an absolute same-origin asset URL ending in `/`, for example `new URL('/midnight/event-pass/', location.origin).href`. The ESM bundle is approximately **17.9 MB** uncompressed / **6.4 MB** gzip, including inline WASM. Lazy-load it when entering the live setup flow. Do not treat it as an already connected UI engine.

Alternatively, a host may import `dist/index.js` through its bundler. It then needs the exact dependencies, browser resolution, `vite-plugin-wasm`, an `esnext` target for native Chrome top-level await, `assert` browser alias, and **module-local** Buffer and process injection as shown in `vite.config.ts`. Dedupe Compact runtime, onchain runtime, ledger and network ID. Do not import the Node adapter or sibling generated contract directly, and do not mix SDK classes from separate copies of those runtimes. The module-local polyfills do not set `window.Buffer` or `window.process`. Actual private-browser smoke exposed an unguarded process dependency; after correction the Node artifact smoke removes both globals. The actual supported cloud Chrome recheck passed at source 07bbaa03; the later immutable service-baseline patch passed both its built-artifact Node smoke and the actual cloud Chrome public-asset check at source 1edf2dfc, each separately recorded. The indexer receives native `WebSocket` explicitly to avoid the upstream `isomorphic-ws` namespace/default mismatch.

## Real owner setup: host responsibilities

Importing this package performs no wallet or credential setup. The host must supply a chosen API-4 instance from `discoverWallets(window.midnight)`. Injection keys are UUIDs, not a guaranteed `lace` name. Display wallet metadata as text; it is not trusted HTML. API version 4.x, connection status and network are checked. Public key identity is rechecked before balance/submission, so account changes require a fresh owner-scoped session. Approved service configuration is a copied, frozen snapshot; in-place mutation of a reused wallet-owned object cannot move its drift baseline.

The intended owner setup is current Lace **2.4.2**, Preview enabled, with a compatible owner-local proof server **8.1.0** configured in Lace. This package calls the actual `wallet.getProvingProvider(zkConfigProvider.asKeyMaterialProvider())` and wraps it with the official `createProofProvider`. It does not use a guessed public prover or deprecated optional `configuration.proverServerUri`. API-4 does not expose enough information to independently attest the actual local-prover installation/destination; the owner must check Lace settings and approve the private destination. Proof preimages leave the page through that wallet-selected proving path.

`createBrowserSession(options)` requires all of these explicit inputs:

- `scope`: test network, opaque owner account identifier, nonzero 32-byte lowercase-hex eventId, and `issuer` or `bearer` role
- `initialApi`: the owner-selected injected API-4 wallet
- `compiledAssetsBaseUrl`: trusted full compiler assets mount
- `encryptionKey`: an **existing owner-provisioned nonextractable AES-GCM-256 CryptoKey**, with encrypt/decrypt usage; never a public-address-derived key
- `proofDestination`: accurate owner-approved identification of Lace's configured local prover
- `authorizeConnection`, `authorizeStorage`, `authorizeWalletProver`, `authorizeOperation`: real review/approval flows supplied by the host. Do not return unconditional approval; callbacks returning true in tests are synthetic fixtures only

The host now provides a dedicated owner-operated custody create/import interface; the owner subsequently reported performing issuer create/import/unlock on their own browser; no private file or key was provided to the build environment. This library performs no automatic capability, signing-key, wallet-seed, password or encryption-key creation. The explicitly reviewed maintenance-key utility is called only by an owner final action, never during import or session construction. Do not ask for these in ordinary chat or put them in URLs, source, env defaults or logs. Creating/materially expanding persistent authority requires explicit action-time approval; owner entry of highly sensitive credentials must be handled through the secure handoff. Existing keys/capabilities are explicit arguments only.

The lower-level `EventPassAdapter` constructor additionally requires an explicit `ownerRole` and the factory’s typed `guardedEffects` boundary. Roles are enforced before any proof/transaction work; an already-bound adapter cannot redeploy. The convenience session factory supplies these correctly.

The facade exposes:

```text
session.adapter.deploy({requestId, eventId: Uint8Array(32), issuerSecret: Uint8Array(32), signingKey}) -> PublicReceipt
session.adapter.join({contractAddress, eventId, issuerCommitment, initialPrivateState}) -> void
session.adapter.issue(requestId, commitment: Uint8Array(32)) -> PublicReceipt
session.adapter.redeem(requestId, commitment: Uint8Array(32)) -> PublicReceipt
session.adapter.revoke(requestId, commitment: Uint8Array(32)) -> PublicReceipt
session.reconcile(requestId, optionalRecoveredDeploymentAddress) -> PublicReceipt | null
session.close() -> void
```

Deployment requires an explicitly supplied existing issuer-owned maintenance key. Join uses actual SDK verifier-key compatibility checks and event/issuer identity reads; **it does not call the SDK helper that auto-generates a maintenance key**. A bearer can join with only their own bearer capability. Sessions created through the convenience factory are fixed to one event. Role-scoped vaults reject another role's capability; a bearer vault cannot accept maintenance authority.

`deriveIssuerCommitment` and `derivePassCommitment` are the genuine compiler-generated pure circuits using Compact's actual serialization/hash. They are not the demo SHA-256 hash. `encodeLiveCredential`/`decodeLiveCredential` use a separate `guestlist-midnight-v1:` envelope with exact trusted network/contract/event matching and recompute the real commitment. Credentials contain a bearer capability; base64 is **not encryption**. Present/transfer them only through owner-approved local QR/copy flows, never in URLs, logs, public receipts or external QR services. The expected identity supplied to decoding must come from a trusted deployment registry, not from the credential itself.

`readPublicState` supports an exact block hash. `readChainStatus` supports wallet-supplied HTTP(S) or native WS(S) node services and queries only version, finalized head and the header pinned to that head. `createBrowserProviders` uses the actual owner wallet configuration for indexer services; no default node, indexer or account is supplied.

## Private custody, journal, finality and admission

`openOwnerStorage` requests approval before opening an IndexedDB database. Its namespace binds owner account, network, event and role; each private record also binds contract address, record kind and state ID through authenticated AES-GCM additional data. Every write uses a fresh random 96-bit IV. State and maintenance keys are encrypted, and the supplied encryption key is retained only in memory. Wrong-key/corruption failures propagate instead of becoming absent state. Private import/export is deliberately disabled pending a separately reviewed secure recovery flow.

Transactions are acknowledged only after IndexedDB `oncomplete`, not request success. The public-only journal atomically rejects duplicate request IDs and unresolved operations for the same scoped event across tabs/connections. Attempt identity cannot change; unknown outcomes cannot regress to pending, and late watchdog updates cannot erase a verified receipt. It is durable **within that browser profile**, not a multi-device coordinator or backup.

Encryption does not defend against same-origin XSS, a compromised host app or a browser operator during an unlocked session. Use an owner-controlled origin, safe DOM rendering and a reviewed recovery plan. Clearing site data can destroy capabilities; the library provides no plaintext fallback or automatic key recovery. Close/drop the session and key references when locking/switching accounts. Closing revokes new downstream effects but does not cancel a prover/wallet/network request already in flight.

Each transaction approval identifies action, test network, public contract/event/commitment, private proof destination, persistence and DUST consequences. The real SDK executes, proves, balances through `balanceUnsealedTransaction`, submits through `submitTransaction`, then waits for indexer finalization. A receipt requires complete `SucceedEntirely` execution, successful segments, actual public transaction-identifier binding, and an exact matching contract/circuit/commitment map-write plus counter increment in that transaction’s typed public transcript. A deployment must contain the matching ContractDeploy/event/issuer. It then requires an independent public-state query **at the finalized transaction's block hash** matching event, issuer and expected pass state. Provider error payloads are redacted; private SDK transaction fields are never copied into receipts/journal.

Operation timeouts and `adapter.close()` revoke later proof/balance/submission stages, with guards checked after asynchronous identity/service reads and immediately before each actual wallet call and low-level prover check/prove, but cannot cancel an already started external request. The official proof wrapper does not reliably honor the SDK's per-call timeout. A timeout or submission interruption is **unknown**, not success or permission to retry. Preserve requestId and candidate IDs, disable re-submit/admission, and reconcile read-only. A deployment address can be recovered publicly and passed to `reconcile`; never redeploy to recover an unknown result. A `null` result remains unresolved.

`verifyAndClaimAdmission` additionally requires an owner-managed **durable global AdmissionStore** enforcing network/contract/commitment claim-once across every physical gate and restart. This package provides that typed boundary, not an implemented gate backend. A receipt replay or a latest `USED` state must not open a gate. Owner IndexedDB journals are not global gate coordination. Never keep all attendees' secrets in a shared issuer/gate database.

## Exact rebuilt UI mapping still required

Current `src/App.tsx` is typed to `DemoService` and reads its `state.passes`, subscribes to local changes, calls `execute`, and shows local receipts. `src/domain.ts` defines demo-only `Pass`, `Receipt`, `Credential`, hashing and `guestlist-demo:` codec; `src/demo-service.ts` stores plaintext synthetic state in `guestlist.synthetic-preview.v1`. None of those are live chain evidence.

1. The root app now has a separate typed live engine and view model; the following mapping describes that boundary and remaining owner checks. Do not pass an EventPassAdapter as an unsafe cast to DemoService. Retain demo/live namespaces and credentials separately. One original Compact deployment is one event; persist the public deployment's network, contract address, eventId, issuer commitment and finalized receipt in a trusted live-event registry
2. Map organiser `execute({type:'issue', label, passType, secret}, 'organiser', requestId)` to an **approved** issuer session and genuine `derivePassCommitment`, then `adapter.issue`. Labels, sequence numbers and Guest/Host presentation types remain offchain. Do not store a real `Pass.secret` in demo localStorage or silently retain every attendee's capability in issuer storage
3. Map revoke by the real public commitment to `adapter.revoke`. Map check-in after `decodeLiveCredential(raw, trustedEvent)` to an approved bearer-capability proof flow and `adapter.redeem`, then independently verify/claim admission. The presenter-to-gate capability transfer/custody design still needs approval; issuer mode cannot quietly become an attendee-secret store
4. Replace `Receipt {mode:'demo', operationId, status:'verified-locally'}` with a discriminated live receipt carrying real transaction/block IDs and independent block-state evidence. `operationId` for UI correlation may remain the nonsecret requestId, but is not a txId. Update success/activity only after a finalized verified receipt. Keep a separate pending/unknown state through reconnects and never show Admitted from a local mutation
5. Map ledger `ACTIVE -> ready`, `USED -> used`, `REVOKED -> revoked`, and `NEVER_ISSUED -> absent/unissued`. The Compact contract has no expiry, event-time or capacity enforcement. The UI's `expiresAt`, 72-pass limit and Host label are application/presentation policies; never claim they are enforced by this unchanged contract
6. Replace `encodeCredential` in PassDialog, PassFace, copy and GateWorkspace with the distinct live codec only in live mode. QR rendering is already local (`qrcode`), which is appropriate. Remove/replace demo text, mock request receipts, preview reset and seeded synthetic passes in that mode. Do not import or upload demo state as deployed passes
7. Replace the Network view's readiness claims with verified wallet/API/network identity, owner-reviewed custody/prover setup, independent node/indexer reads and real deployment receipt. Disable live actions until all required setup/approval is complete; a live facade import alone does not meet readiness

## Expected fail-closed errors and remaining acceptance run

- No API-4 wallet or declined connection: stay disconnected; never silently select another wallet
- Wrong network/account change/global SDK network drift: close the scoped session and start explicit setup again
- Missing/extractable/wrong custody key or corrupt record: remain locked; no empty-state reset or plaintext fallback
- Unknown/missing/mismatched circuit asset: stop; regenerate/mount the complete compiler artifact set
- Wrong event/issuer/verifier/capability or wrong live credential identity: reject before proving
- Duplicate/unresolved event request, failed/partial finalization, stale state, or unknown outcome: fail closed; reconcile only, never admit or blindly resubmit
- Denied prover/operation approval: no proof or transaction proceeds

The remaining real acceptance run requires owner-approved Chrome/Lace, a working owner-local compatible prover, test NIGHT/DUST readiness, reviewed private custody/authority setup and an approved deployment/circuit run. Deploy, record finalized successful receipt/address, issue a synthetic pass, redeem once, verify independent finalized-block state and claim admission once, reject replay, issue/revoke another pass and reject redemption. Capture public-only evidence. Until that completes, describe this as an implemented typed browser boundary with offline evidence, **not an onchain-deployed or end-to-end-tested DApp**.

Primary references: [deployment/provider guide](https://docs.midnight.network/guides/deploy-and-operate), [support matrix](https://docs.midnight.network/relnotes/support-matrix), [proof-server guide](https://docs.midnight.network/guides/run-proof-server), [official fetch ZK provider](https://www.npmjs.com/package/%40midnight-ntwrk/midnight-js-fetch-zk-config-provider), [runtime dedupe issue](https://github.com/midnightntwrk/midnight-js/issues/1052). Exact API behavior was also checked against the installed pinned official declaration/implementation files.

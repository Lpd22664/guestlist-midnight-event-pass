# Guestlist shared gate admission service

A bounded, owner-hosted, public-data-only coordinator for one test-network Guestlist deployment registry. It uses Node **24.19.0** built-in `node:sqlite`, a single durable SQLite file, existing pinned Midnight SDK public-data providers and the browser integration's hardened exact transaction attribution/state verifier. There is no additional package installation, account setup, wallet, prover, transaction submission, attendee database, remote database or default secret. A separate owner-terminal setup command can create fresh local gate API authority only after the owner personally types its final scope-bound confirmation; imports never provision authority or start a listener.

**Implementation, offline tests and a public read-only Preview check. No gate service listener was started, no gate credential provisioned, and no live transaction or deployment performed by this repair.** This service is not mounted into the static demo. Real owner setup, personal private connection-file import and a live gate acceptance run remain necessary. The new setup/launcher has only been exercised with fixed synthetic fixtures and refusal paths, not production provisioning.

## Gate lifecycle and exact trust boundary

1. The authorized gate calls `openRedemption` with a public request ID and its configured network/contract/event/issuer/pass commitments. The server uses its owner-configured node to pin a finalized head, then independently queries the contract state **as of that exact block hash**, including state inherited from an earlier action. It checks the indexer block hash/height, exact contract address, all three build-pinned verifier keys and exact circuit set on the same snapshot, then rechecks the anchor against the canonical finalized node chain. Only **ACTIVE** can create a durable, expiring gate attempt. Only one open/bound/claimed attempt exists for each network + contract + pass commitment across every gate and process.
2. The bearer, on their own approved wallet device, redeems using the public gate request context. The capability stays on that bearer device. The gate service never receives a bearer credential, issuer capability, signing key, wallet data, proof preimage, name or email. `requestId` is public application correlation, **not a contract argument or a cryptographic gate challenge**.
3. Before the attempt's 5-minute binding deadline, the gate supplies only the public candidate transaction identifier. That identifier binds durably to this attempt and cannot change. The server independently obtains actual finalized public transaction data from its configured indexer. It requires the bound canonical ID or alias in the **actual typed public transaction's identifiers**, full `SucceedEntirely`/successful segments, the exact generated redeem entrypoint, pass-map write and redeemed-counter increment, and independent USED state with the same pinned verifier-key/circuit-set checks at that transaction's block hash. An independent node must show this exact block hash is canonical and at/below its finalized head. Its height must be **strictly greater** than the ACTIVE baseline. Same-block ambiguous cases fail closed.
4. SQLite `BEGIN IMMEDIATE`, unique constraints and a `synchronous=FULL` commit are the single admission-grant linearization point. Only the first successfully committed claim returns `admit:true`. Other concurrent scanners, replay, recovery and restart return `admit:false`. The UI may show Admitted only for that first successful authenticated response.

A receipt-only claim, a latest USED state and a bearer self-redemption finalized before the gate opens cannot authorize entry. There is no endpoint to import a client success/receipt/USED flag and no automatic admission from a timeout callback.

**Unchanged-contract limitation:** Compact redeem contains no gate authorization, nonce, scanner identity or admission policy. A bearer self-redemption already in flight, or performed after an authenticated gate opens, can be indistinguishable from redemption initiated in that physical gate session. This service enforces an owner-managed online lifecycle; it cannot prove causal scanner initiation. A stronger cryptographic gate policy requires a separately reviewed contract/protocol change. The node and indexer are explicitly owner-trusted public-data services, not cryptographically trustless light clients. The event registry must come from a verified deployment and those endpoints must refer to its exact test network.

**Physical-entry limitation:** a committed grant can have its HTTP response lost before a door opens. Retrying never produces another grant. Read-only recovery can show the durable claimed record, but cannot establish whether a person physically entered. That case needs owner-supervised physical reconciliation. Automatic re-admission would break at-most-once entry, so no such override/reset exists here.

## Build and offline tests

The sibling browser boundary must first have its genuine generated artifacts, pinned dependencies and `dist` built using its README. The root supplies the existing TypeScript compiler and Node types; this package intentionally adds no new registry dependencies.

```sh
npm --prefix browser-integration run build
npm --prefix gate-service run verify
```

**88 offline tests** pass, with a strict TypeScript check; the repair output is recorded in `evidence/as-of-verification.txt` (the earlier 75-test checkpoint remains in `evidence/verification.txt`). Offline tests cover real locally SDK-created public transcripts and generated ledger states with explicitly synthetic finality metadata; wrong transaction/commitment/status/state, prebaseline/same-block consumption, real tagged transaction IDs, verified canonical/submitted aliases through the reader → service → SQLite boundary, invented aliases, independent canonical/finality RPC, authenticated HTTP schemas/CORS, replay, concurrent independent gates, twelve concurrent claims, four concurrent processes sharing a database, expiration, unknown binding, timeout/late resolution, bounded outstanding reads, restart/recovery, public-only serialization, service revocation and storage failure. Browser wire regressions cover truthy string admission, contradictory code, altered IDs/context, malformed receipt/state, unknown extra/private fields, oversized streamed replies, error redaction and close during an outstanding request. The 28 owner-setup tests add exact public manifest/origin/port/config schemas, scope-bound consent, TTY/no-argument guards, version policy, exclusive owner-only files, refusal of source paths/symlinks/hardlinks/shared modes/missing databases, SQLite sidecar modes, import-side-effect regressions and unattended CLI refusal. All file-writing tests use explicitly fixed synthetic authority. No test opens a network listener, creates fresh random API authority or uses real credentials. The alias regression wraps a real typed SDK transaction in explicit synthetic alias metadata; it does not claim a genuine network alias was observed.

## As-of finalized state repair (7 October 2026)

The pinned SDK 4.1.1 `queryContractState(address, {blockHash})` reads `contractAction` **at that exact action block**. It returns null at an idle finalized head. The baseline now uses the current indexer v4 `contract(address, offset: {hash}) { address state }` API, whose state is the latest action at or before the requested block. The same bounded query requests `block(offset: {hash}) { hash height }`; both coordinates must match the independently pinned node head. No latest-state fallback, backward scan or recent-action heuristic is used. `Contract.actions` is intentionally excluded because its list is not offset-bound.

The reader rejects missing/stale/future/mismatched anchors, wrong contract, partial GraphQL errors, malformed state, missing/changed/extra circuit keys, unavailable services, and noncanonical or unfinalized rechecks. Reads use a 15-second abort signal, no credentials/redirects/cache, and a 4 MiB streamed response cap; larger contracts fail closed. The three local verifier files are length/digest checked against the existing compiler manifest. Exact successful transaction attribution and durable claim-once remain unchanged. Receipt state receives the same key checks.

[Actual production-reader evidence](evidence/as-of-preview-read.json) passed against the original Preview contract at finalized height **1194018**: correct public event/issuer, all three verifier keys, and 0 issued / 0 redeemed / 0 revoked. An earlier same-head negative control returned null from exact `contractAction` while genuine `contract(offset)` returned state. This establishes the reader path and idle-head repair, **not an accepted live pass lifecycle or admission**. Offline regression tests cover older ACTIVE state, several later updates, updates exactly at the anchor, malformed/stale/future/offline/error/oversize responses, finality failures and key changes.

The node and indexer remain owner-trusted services. A canonical block-hash check is not a cryptographic proof binding a server's returned state to that block; the service deliberately does not claim to be a light client. Current API semantics: [official as-of design](https://github.com/midnightntwrk/midnight-indexer/issues/1275), [contract resolver](https://github.com/midnightntwrk/midnight-indexer/blob/main/indexer-api/src/infra/api/v4/contract.rs).

## Browser integration

Import only the browser-safe `gate-service/src/client.ts` in the root app, or the built `@event-pass/gate-service/client` module. It has no Node, SQLite, wallet or SDK runtime imports. Public result types are exported from the same module.

```ts
const gate = createAdmissionClient({
  serviceUrl: ownerApprovedHttpsOrLoopbackUrl,
  gateId: ownerAssignedGateId,
  apiSecret: existingSecretEnteredThroughApprovedOwnerHandoff,
});
await gate.health();
const opened = await gate.openRedemption({
  requestId, network, contractAddress, eventId, issuerCommitment, commitment,
});
// Give ONLY opened.attempt public context to the bearer; redeem on their own device.
const claim = await gate.claimRedemption({ requestId, txId });
// Open a gate only when claim.admit === true and returned public identity is exact.
const recovery = await gate.readRedemption({ requestId }); // Always admit:false.
gate.close();
```

The browser client strictly validates unknown JSON for every health/open/claim/read response before returning it: exact allowed fields, boolean admission flags, code discriminators, public IDs/state, configured health registry and copied opened-attempt identity. Open and read can only return `admit:false`; a claim grant requires exact `admit:true` with `code:admitted`. Genuine canonical/submitted transaction aliases remain supported. Responses require `application/json` and are streamed with a hard **128 KiB** cap. Unexpected server codes, payload fragments, JSON failures and network error messages are redacted to fixed public errors. Closing the client aborts outstanding fetches and refuses late responses; it cannot undo a grant already committed on the server.

Validate service health's exact policy/event registry and the response identity before enabling UI actions. Service health attests configured policy/storage, **not current chain connectivity or live deployment verification**. Do not embed gate authority in source, `VITE_*`, static hosting, a public URL, localStorage, an attendee credential or demo state. Creating/provisioning persistent API authority requires explicit owner action-time approval. The separate terminal command below implements that final owner action locally; the service and browser client consume its supplied authority. Personally import the generated private connection file into the exact reviewed app: the assistant must not read, upload, paste or transmit its API secret. Client closure keeps its authority in one mutable reference and drops it on `close()`; JavaScript cannot promise secure memory erasure, and the caller must also release its own references. There is no default key or automatic setup approval.

The bearer receives only public opened-attempt context. There is no unauthenticated attestation endpoint; the bearer should confirm the request context came from the actual authorized gate before approving redemption. A context document is not proof that a person will be admitted. Bearer UI should say redemption finalized and admission awaits the gate's durable claim.

Genuine pinned ledger transaction identifiers are **66 hex characters** (tagged 33-byte IDs); transaction hashes, contract addresses and event/pass commitments are 64. The public API accepts bounded lowercase 64/66-character transaction IDs and never truncates them. A submitted alias must appear in the typed transaction and receipt identifiers; a differing canonical receipt ID remains canonical in the record while the original candidate alias remains bound to the attempt.

## API

All endpoints require `X-Gate-Id` and `Authorization: Bearer <existing gate API key>`. There are no cookie sessions. Authentication runs before caller JSON is read or chain access starts. Bodies are limited to 2 KiB and exact public fields; unknown fields, raw receipts, capabilities, compressed bodies and URL query parameters are rejected. Provider errors are returned as fixed public error codes, never copied into logs or responses.

- `GET /v1/health`: policy, durable storage declaration, configured public event identities
- `POST /v1/redemptions/open`: exact `requestId, network, contractAddress, eventId, issuerCommitment, commitment`; returns an opened public attempt, never admission
- `POST /v1/redemptions/claim`: exact `requestId, txId`; verifies on the server and returns the one-time grant or `already-claimed`
- `GET /v1/redemptions/{requestId}`: gate-scoped read-only pending/expired/claimed status and any previously verified public receipt; always `admit:false`

Default limits: one network per process, 128 configured gates/events, 50,000 retained attempts, 32 outstanding combined baseline/transaction verifications, 30-second request verification timeout, 5-minute unbound-attempt lifetime, 2-second SQLite busy wait. A candidate bound during the window remains bound through late finality/restarts; there is no automatic unknown reset or expiry. Capacity exhaustion, corruption, lock contention or disk failure close admission, never erase claims to make space.

After a verification timeout, preserve the same requestId and candidate ID and use read-only recovery or explicitly retry verification of that same candidate. Never resubmit/redeem, change candidate, clear storage or open a new attempt to recover an unknown outcome. Underlying official SDK watch reads cannot reliably be canceled: unresolved reads are reused and capped, and their late completion never commits a grant without a new live authenticated claim call. A stopped service also revokes late admissions. Restart can begin a new read of the same durably bound candidate, while completed claim records remain replay-safe.

## Owner-terminal setup and separate launch (not performed)

All physical gates must reach **one service authority and one durable local SQLite file**. Multiple service processes may share that same local-host file. Separate per-device databases, cloned databases, in-memory storage, load-balanced servers with independent files and network/cloud-sync filesystems do not provide global claim-once. The filesystem must support SQLite locking and durable sync. Both setup and launch enforce Node **>=24.19.0 <25** and SQLite **>=3.51.3**, including the official multi-connection WAL-reset corruption fix. The verified Node 24.19.0 runtime includes SQLite 3.53.3.

### Exact steps on the owner's CachyOS terminal

1. Use the existing pinned project/runtime checkout. Build the sibling SDK boundary and this service; no new dependencies are added here:

   ```sh
   node --version
   npm --prefix browser-integration run build
   npm --prefix gate-service run verify
   ```

2. For the existing recorded Guestlist deployment, use the included [`preview-event.public.json`](preview-event.public.json). It contains only the four public event fields, independently rechecked against Preview on 7 October. In the app, expand **Check the public identity** and compare every value; use this file only for that exact event. The current **Copy public event link** button copies an invitation link, not a JSON manifest. To obtain the absolute manifest path for setup, run `realpath gate-service/preview-event.public.json` from the project root. For a different reviewed deployment, save a separate JSON containing exactly `network, contractAddress, eventId, issuerCommitment`. Never choose an attendee QR, custody/recovery file or private gate connection file. The setup command itself does **not** verify chain state or keys.

3. Choose your exact trusted app origin, one unused unprivileged port (1024–65535), your own gate ID and a **new** absolute directory on a durable local filesystem **outside this repository and every static hosting tree**. For example, choose a new directory under your existing owner-controlled home directory. Do not choose `/tmp`, a Downloads/public hosting folder, network mount or cloud-sync folder. The parent directory must already exist, belong to your non-root user and not be group/world-writable. Ancestors must be controlled by that user or root and non-writable by other users; root-owned sticky ancestors are permitted by the filesystem checks. The new directory must not exist, even if empty. Symlinked path components are refused. Do not use `sudo`, an `.env` file, a secret command-line argument or copied test keys.

4. Run this command personally in an interactive terminal, with no arguments:

   ```sh
   npm --prefix gate-service run owner:setup
   ```

   Enter the absolute public-manifest path, exact app origin (scheme + host + optional port, no path/trailing slash), explicit port, gate ID and new private directory when asked. No values are guessed. HTTPS is required for a remote app origin; HTTP is allowed only for an exact loopback app origin. The command displays the exact event, app authentication recipient, gate ID, loopback listener URL, private file paths and these official public Preview read endpoints:

   - Node RPC: `https://rpc.preview.midnight.network`
   - Indexer GraphQL: `https://indexer.preview.midnight.network/api/v4/graphql`
   - Indexer subscription: `wss://indexer.preview.midnight.network/api/v4/graphql/ws`

   Review everything. To authorize creation, personally type the displayed exact **CREATE PERSISTENT GATE AUTHORITY** phrase with its gate ID and public-scope fingerprint. Any other answer cancels without authority generation or private writes. Pipes, redirected output, arguments and `--yes` are refused. No fresh authority exists before that final confirmation.

5. After your final approval, the command obtains 32 bytes from Node's cryptographic random source and creates a new mode-0700 directory with exclusive, mode-0600 files:

   - `guestlist-gate-server.json`: private server configuration, event, fixed public Preview endpoints, exact app origin, port, gate ID, API secret, absolute database path and original database instance metadata
   - `guestlist-gate-client.json`: private app connection file with exactly `schema: guestlist-gate-client-v1, serviceUrl, gateId, apiSecret`; the URL is your chosen `http://127.0.0.1:PORT`
   - `gate.sqlite`: the **one** privately reserved database file, initially empty; the separate launch initializes SQLite

   Neither secret nor private JSON is printed. Files are never overwritten. The directory/files are synced before success is reported. Setup does not contact an endpoint, initialize SQLite, start a listener or configure autostart. If a write fails after approval, partial private files may exist: preserve and inspect them locally; the command does not delete or replace them. Do not blindly rerun provisioning to recover an existing active gate.

6. Start the service separately, only when you choose to operate the gate. Substitute your actual absolute server-config path; this command contains a **path, never a secret**:

   ```sh
   npm --prefix gate-service run owner:launch -- "$HOME/YOUR-PRIVATE-DIRECTORY/guestlist-gate-server.json"
   ```

   The launcher checks the non-root owner, private directory/file modes, absence of symlinks/hardlinks, safe owner/root-controlled directory ancestry, exact server schema, fixed official Preview endpoints and the original sibling `gate.sqlite` instance. A missing/moved/replaced database is refused using its recorded device, inode and creation-time metadata. The launcher holds the validated database descriptor through module loading and checks its identity before and after SQLite initialization, before opening the listener. It maps only validated fields into the existing service environment inside that process and starts the existing **127.0.0.1-only** listener. Inherited gate env values cannot override the validated config. It does not put authority in argv, URLs or logs. SQLite WAL/SHM sidecars inherit the reserved database's 0600 mode. Keep the terminal open; Ctrl+C stops service operation. Nothing enables a daemon, docker group, firewall rule or remote listener.

7. Personally select `guestlist-gate-client.json` in the gate section of the **exact private app origin you reviewed**, and review the authentication recipient before connecting. This intentionally transmits the API secret from your browser to the local gate service; the app must not store it in localStorage or publish it. This connection file is compatible with the existing app importer, but it is **private persistent authority**, not a public manifest or bearer QR. The issuer and bearers do not receive it. On Lock/mode exit, the app releases its in-memory client reference.

### Material authority and storage implications

Anyone possessing either JSON file's API secret can authenticate as that gate and open/claim attempts for the configured public event. Exact-origin CORS protects browser access patterns; it is **not** a substitute for protecting the secret and does not stop a non-browser caller holding it. This narrow setup provisions **one** gate ID; do not run it on every scanner to create separate databases. Broader multi-gate provisioning, credential rotation/revocation and remote access need a separately reviewed owner procedure. A local OS user with sufficient privileges can still inspect process memory or files: file modes are not encryption.

Keep both JSON files and SQLite/WAL/SHM files out of source control, static hosting, Sites attachments, app bundles, `VITE_*`, public URLs, attendee credentials and chat. The runtime also refuses storage anywhere within this checkout, and ignore patterns are defense in depth. Other unrelated hosting directories cannot be discovered reliably by this command; choose a private local directory yourself. Private directory paths must be absolute/normalized, not `~`, aliases or symlinks. No existing owner security settings are changed.

The loopback client URL reaches the gate on **the browser's own computer**. A phone or another scanner's `127.0.0.1` is not this owner's service. Browser Private/Local Network Access permission may require a personal browser approval, and browser policy can block a hosted HTTPS page from reaching loopback. Do not bypass security warnings or change hosting/sharing to work around it. Multi-device reachability, TLS termination, remote hosting, firewall/reverse-proxy changes and persistent access expansion are separate owner-reviewed infrastructure steps; this launcher does none of them. Service health attests policy/storage and event configuration, not chain connectivity or a live acceptance run.

Original-file metadata helps reject accidental database replacement; it cannot detect in-place rollback or an owner changing both private files. Protect the single authoritative database from rollback/tampering. Deleting it, restoring an older copy or creating a fresh service to recover an unknown claim can forget prior entry grants and permit replay. Do not restore stale copies while gates are active. Use a reviewed consistent SQLite backup and physical-entry recovery procedure. No automatic backup, reset, migration, override or re-admission feature is added.

### Existing env-only integration remains available

The original explicit environment route is retained for already-reviewed owner provisioning; it does not create authority. There is no `.env` secret template or default secret:

- `GUESTLIST_GATE_KEYS_JSON`: object mapping assigned gate IDs to separately provisioned authority
- `GUESTLIST_GATE_DB_PATH`: absolute path to the one owner-managed durable local SQLite file
- `GUESTLIST_GATE_PORT`: explicit loopback port, 1024–65535
- `GUESTLIST_GATE_APP_ORIGINS_JSON`: exact approved origins, no wildcards
- `GUESTLIST_GATE_EVENTS_JSON`: trusted entries with exactly `network, contractAddress, eventId, issuerCommitment, nodeRpcUri, indexerUri, indexerWsUri`

`npm --prefix gate-service run start:loopback` still starts that explicit env-only route. Remote public endpoints require HTTPS/WSS without embedded credentials, query data or fragments; only public read RPC methods are used. The new owner-config route is deliberately narrower: one supplied verified Preview manifest and the displayed official Preview endpoints only. Neither route mounts private files into the static app or accesses wallet/prover/issuer/bearer custody.

## Primary references

- [Official Midnight public environments/endpoints](https://docs.midnight.network/relnotes/network) and [v4 indexer subscription path in the deployment guide](https://docs.midnight.network/guides/deploy-and-operate), checked 5 October 2026; the setup does not query these endpoints
- [Node built-in SQLite](https://nodejs.org/api/sqlite.html)
- [SQLite transactions and BEGIN IMMEDIATE](https://www.sqlite.org/lang_transaction.html)
- [SQLite WAL, local-host constraints, backup caveats and WAL-reset fix](https://www.sqlite.org/wal.html)
- [Pinned browser integration and exact generated receipt verifier](../browser-integration/README.md)
- Installed official Midnight SDK 4.1.1 declaration/implementation files and the unchanged compiler-generated event-pass contract

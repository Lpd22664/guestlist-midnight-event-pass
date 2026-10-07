# Guided Guestlist journeys

Implementation checkpoint: 7 October 2026. Based on public source `6bb1b2bc8f99c7c2a3ea951d010c8290f01a390a`. Original Compact source, deployment, issuer identity and gate backend are unchanged. This is a prototype engineering review, not an independent security audit or a live acceptance certificate.

## What changed

- Three Preview paths: Organise an event, My pass, Run the door. Each shows the current step, a focused action and secondary recovery/details
- Existing-event resume is the default. A new issuer/deployment is a separate deliberate branch; failed unlock never generates a replacement
- Public invitation links fill only Preview network, contract, event ID and issuer commitment. Fragments avoid sending those fields in HTTP queries. No account namespace, prover URL, secret or gate authority is accepted
- Read-only public event and pass-status verification is separated from a wallet session. It verifies the exact same indexed contract state against all three pinned verifier keys; it is not a finalized gate baseline or admission proof
- Guests generate and save their own access once, then use their public request QR. Wallet/prover connection is deferred until actual redemption, with the installation/funding requirement shown early
- Live default QR codes are public. The three handoffs are guest pass → gate request → finalized receipt. Camera and QR-image decoding happen locally, without upload. Paste remains an advanced fallback
- Organisers scan public requests and issue under their original authority. Gate staff never need a bearer/issuer secret, wallet or prover
- The local synthetic demo exposes Create pass → Present this pass → Try check-in → Check in. It carries the selected pass and gives direct replay refusal
- Public route preferences and exact request contexts survive return visits. Private access remains locked; pending outcomes require read-only reconciliation

## Device unlock and recovery

The separate device-access store encrypts the **existing** recovery package, including its existing AES vault key and role capability. It does not change SDK private-state IDs, owner/event/role namespaces, maintenance keys, contract identity or unresolved journals.

PBKDF2-SHA256 uses 600,000 iterations and a random 16-byte salt; AES-256-GCM uses a fresh 12-byte IV and authenticates version, scope, KDF and cipher parameters. Passwords need 15–128 characters. No password, plaintext key, secret or ready-to-use CryptoKey is stored. Stored public metadata remains untrusted until successful decryption and scope validation.

Writes are add-only and atomic. Existing same-scope authority is never replaced. Discovery errors block new creation; wrong passwords do not create access. Import/setup/unlock has explicit owner review and cancellation guards through asynchronous derivation and IndexedDB commit. Dismissing access or locking invalidates late work.

Existing unencrypted recovery files remain supported for local import. New setup saves and unlocks the same capability without immediate download/reimport. Optional encrypted backups can be exported from the access screen and restored with the original password. An imported backup is authenticated before adding it to device storage.

Limits:

- Browser storage is not backup. Profile deletion, site-data clearing, eviction or device loss can erase it
- Losing every issuer copy prevents further issue/revoke; the original contract has no issuer rotation
- Losing a bearer secret makes that pass unusable. The organiser may revoke ACTIVE and issue a new request, but cannot recover the old secret
- Password encryption protects locked data at rest. It does not stop malicious same-origin code or a compromised unlocked device, and has no biometric/passkey claim
- JavaScript strings cannot be reliably zeroized. Password/file state is cleared promptly; typed arrays are wiped where possible
- Custody backup does not replace the gate database’s independent durable backup/recovery requirements

## Security and interruption boundaries

- Event links and QR codes are strict bounded allowlists, with duplicate/extra/private fields rejected. They never establish event trust or authorization by themselves
- Public event changes cannot reuse mismatched unlocked custody or discard an unresolved gate request in another event
- Gate authority stays in memory and goes only to the explicitly reviewed HTTPS/loopback service. All existing endpoints remain authenticated; no guest polling or secret-bearing rendezvous was added
- The guest’s request context is exact-bound to event, commitment, baseline, request ID and expiry. Historical contexts can be restored for receipt recovery but must pass a fresh expiry check to authorize redemption
- Redemption expiry is enforced before/after consent and before later proof/balance/submit effects. Already-started wallet operations or submissions cannot be recalled; uncertain outcomes remain recorded as unknown
- Gate receipt scans are candidates only. The backend verifies transaction attribution, finalized USED state after its prior ACTIVE baseline and first durable claim
- Lost opening/claim responses recover only their preserved context. An unclaimed bound transaction can be explicitly rechecked with the same transaction; a status read never admits
- Dismissing or leaving a displayed admission consumes its UI display epoch. A late successful response or later remount cannot resurrect the green admission grant
- No remote proving, fee sponsor, embedded wallet, experimental WASM rollout, security-setting change, new on-chain deployment or owner-private-data action was performed

## Measurements and verification limits

The implementation includes an automated four-primary-action demo assertion. It records actual button/summary activations after label entry, verifies no clipboard/files, confirms one local admission, and checks direct rejected replay. Until the browser suite runs successfully, **four actions is implemented and asserted by a test, not a measured completed browser result**.

The earlier hosted audit observed five actions: Create pass → Present this pass → Preview tools → Try check-in → Check in. Its screenshots did not establish the hosted commit, so it is not a controlled same-build timing baseline. No live-role click/time savings are asserted.

Current verification commands and exact outcomes will be recorded in the accompanying build report. Offline tests do not prove browser native IndexedDB/WebCrypto behavior, camera compatibility, accessibility, network finality, real wallet integration or physical admission.

Browser verification in this cloud shell is blocked by Chromium IPC socket restrictions, including an approved elevated launch. The cloud browser also blocks local loopback navigation. These restrictions were not bypassed. If an approved private hosted preview is available, visual/manual synthetic QA can run there; otherwise screenshots and native browser suites remain pending.

## Owner-controlled acceptance still required

Use the existing recorded Preview deployment and original owner-held issuer access. Keep the supported Lace 2.4.2 / local proof-server 8.1.0 path. Do not submit owner secrets or recovery JSON to an assistant.

Before any live claim:

1. Personally validate initial import, password unlock, encrypted backup restore and cancellation on the intended trusted browser/origin
2. Verify original issuer/event/contract identity and verifier keys, then actual issue → bearer redemption → finalized USED
3. Verify replay refusal, revoke → refused redemption, pending/unknown recovery, wallet account/network drift and insufficient funding
4. Validate the durable gate’s as-of ACTIVE baseline reader, transaction attribution, concurrent first claim, expiry, outage and lost-response recovery
5. Check keyboard/screen-reader operation, 320/390px and 200% layouts, real camera/image scanning and real device-to-device public QR transfers

Existing independent evidence proves genuine local circuit proofs and the original Preview deployment at block 1169309. It does not prove this end-to-end network lifecycle or live gate acceptance.

## Offline verification record

The final local aggregate passed 420 tests: 249 application, 19 generated-contract, 73 genuine-SDK offline, 75 gate-service and 4 retired-adapter checks. TypeScript, production build, compiler-asset hashes, source-pattern scan and 40 designated contrast pairs passed. The independent code review added 14 race/scope/recovery regressions and identified no remaining actionable finding in its reviewed scope. This is not an external security audit.

Fifty desktop/phone browser cases are discoverable, including the existing 22 and 28 new journey cases. They have not executed on this revision in the blocked cloud shell. Native SDK browser-runtime checks, screenshots, camera tests, measured click counts and the real owner/network/gate acceptance remain unrun. Exact machine-readable scope and limitations: [verification.json](../evidence/journey-simplification/verification.json).

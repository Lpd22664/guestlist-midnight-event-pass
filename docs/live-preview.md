# Guestlist: owner-controlled Midnight Preview mode

The rebuilt app now has two isolated modes. **Local demo is the first-visit default** and never opens private storage, connects a wallet, generates custody or submits a network transaction. **Midnight Preview** lazy-loads the genuine browser SDK bundle and compiler artifacts. Entering that mode loads code and presents role choices. Public route preferences can resume later; secrets remain locked.

The interface implementation task performed no owner custody, wallet, signature or network action. Subsequently, the owner personally deployed the original contract on Preview; independent official node/indexer reads verified its successful deployment and canonical finalized block 1169309. [Current reviewer status](reviewer-status.md) links that public evidence and the successful source CI. Accepted network issue/redeem/revoke and live durable-gate admission remain pending. Reviewers can use the [local synthetic demo](demo-walkthrough.md) without entering this setup flow.

## Before the owner takes over

Use your own trusted HTTPS/loopback app origin in Chrome with API-4 Lace. Review Preview, compatible owner-local prover settings, test NIGHT/DUST readiness, and the admission backend configuration. An API-4 wallet cannot attest the actual private-prover installation/destination; you must verify Lace settings yourself.

The final private-authority actions belong to you:

1. Choose **Organise an event**, **My pass**, or **Run the door**. Open a public event invitation from a trusted organiser. The recorded Guestlist Preview deployment is an explicit shortcut, not automatically trusted. Review the exact network/contract/event/issuer; public reads verify the on-chain identity and original circuit keys. A pass QR never establishes event trust.
2. Existing organisers restore the original issuer once through the local recovery picker. Empty public metadata is restored from the selected file after review; original owner/event/role namespaces and transaction journals remain unchanged. Never generate a replacement issuer to recover the recorded event. Optional password-protected storage removes repeat imports. Returning users unlock the same encrypted authority.
3. Guests create their own bearer capability on their device with an explicit owner action and password-protected save. No download/reimport loop is required. Show the resulting **public pass request QR** to the organiser. The issuer approves that public commitment and never receives the bearer secret. Refresh checks public indexed status and circuit compatibility without a wallet. ACTIVE does not mean physical admission.
4. Before a real transaction, explicitly connect the selected API-4 wallet. The supported owner path remains Lace 2.4.2 in Preview with local proof server 8.1.0 at localhost:6300 and test DUST. Typing a prover destination does not install or attest it. Connection, encrypted role storage, private witness destination, and transaction reviews remain explicit. The app checks finalized node state and joins the exact event before submitting.
5. Organisers scan a public request and review **Issue pass**. Final success requires complete transaction attribution and independent state at its finalized block. Revocation is under advanced public-commitment details and remains a separate permanent action. New event authority/deployment is a separate deliberate branch and cannot recover an unresolved event.
6. Gate staff import their existing owner-provisioned gate connection file and approve the exact authentication recipient. Every physical gate must use the same durable backend. Its API secret stays memory-only and never appears in a guest code, event link, browser public storage or issuer/bearer vault. No wallet or prover setup belongs to the gate route.
7. The guest shows a **public check-in QR**. The gate scans it, verifies ACTIVE, opens a request and shows a **public request QR**. The guest scans that exact request, reviews the event/pass/expiry, and approves redemption on their own device. Expiry guards stop new proof/balance/submit effects after the request deadline; an already submitted transaction cannot be recalled. Public request codes are not signed gate authority, so the guest must obtain them from their actual trusted gate.
8. The guest shows a **public finalized receipt QR**. The gate independently verifies transaction attribution, pinned USED state after its ACTIVE baseline and first durable claim. Only that response says Admitted. Read-only status, replay and lost-response recovery never grant a second entry. A bound unclaimed request can be explicitly continued with the same transaction; a new redemption is never automatic.
9. Save an optional **encrypted recovery backup** from the access screen. It restores the same authority and needs its original password. Device storage is not a backup. Losing every issuer copy prevents future issue/revoke; losing a bearer capability makes its pass unusable. The old unencrypted recovery format remains import-only; keep existing files secure and never paste/upload them to chat or the gate.

Password storage uses PBKDF2-SHA256 (600,000 iterations), random salt/IV and AES-256-GCM with authenticated exact scope. It protects locked data at rest, not malicious same-origin code or an already compromised device. No biometric/passkey protection is claimed. See [the focused implementation and acceptance record](journey-simplification.md).

## Machine-readable consent and interruption rules

`src/live/consent.ts` exports `CONSENT_REQUIREMENTS`: authority creation is per-action, private file and existing gate-authority import require owner handoff, storage/connection/presentation and private prover/transaction reviews are explicit. `ConsentQueue` stays pending until an actual owner response. There are no unconditional production approval callbacks. Agents must not activate these owner controls during QA or enter private values for the owner.

Lock/mode exit invalidates async session generations, closes sessions and gate clients, discards capabilities/keys and clears private QR. Late responses never reconnect, reveal a credential, restore a joined role, or grant admission. Public request/transaction IDs are preserved as unresolved for read-only recovery.

The controller persists only exact allowlisted public request metadata/receipts and gate contexts in a separate Preview namespace. Secret files, capabilities, keys, labels and provider error payloads never enter that namespace. SDK encrypted IndexedDB provides the durable scoped transaction journal. Pending/unknown transactions block resubmission; read-only reconciliation uses the original owner/event/role/request ID, including across reloads. Corrupt/unavailable history fails closed. Browser profile storage is not multi-device gate coordination or a custody backup.

## Offline build and tests

- `npm run stage:live`: build the single genuine browser ESM/WASM boundary and copy it plus the complete integrity-manifested compiler assets into `public/midnight/`
- `npm run check`, `npm run test:live`: strict application type-check and synthetic controller/custody/race tests
- `npm run test:browser`: genuine SDK offline tests and bundle smoke; this is separate from browser execution/owner network acceptance
- `npm run build`/`dev` stage live assets first. A subpath mount requires adjusting the explicit SDK/assets URLs; the current mount is root-level

Offline synthetic test keys/providers are fixtures only. Actual browser SDK runtime and desktop/phone synthetic E2E passed in the [3a18aa7 CI run](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37451385375). The independently verified owner deployment is separate evidence. Funding/prover reports, accepted network circuit lifecycle and durable backend operation require their own acceptance; deployment alone does not establish end-to-end admission.

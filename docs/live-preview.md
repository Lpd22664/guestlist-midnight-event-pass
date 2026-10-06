# Guestlist: owner-controlled Midnight Preview mode

The rebuilt app now has two isolated modes. **Local demo is the default** and never opens private storage, connects a wallet, generates custody or submits a network transaction. **Midnight Preview** lazy-loads the genuine browser SDK bundle and compiler artifacts. Entering that mode only loads code and discovers injected wallet metadata.

No actual owner custody creation/import, wallet grant, proof, signature, deployment, transaction or gate admission was executed while implementing this interface. Live deployment and end-to-end acceptance remain unverified.

## Before the owner takes over

Use your own trusted HTTPS/loopback app origin in Chrome with API-4 Lace. Review Preview, compatible owner-local prover settings, test NIGHT/DUST readiness, and the admission backend configuration. An API-4 wallet cannot attest the actual private-prover installation/destination; you must verify Lace settings yourself.

The final private-authority actions belong to you:

1. On the issuer device, choose a nonsecret stable account alias and a new public 32-byte event ID. Personally select **Create my private recovery file** and review the action-time authority/persistence notice. Include issuer maintenance authority only for a new deployment. The final owner click creates cryptographically random role-specific material and uses the official SDK maintenance generator when requested. The downloaded file is private, unencrypted recovery authority. Secure it offline; never upload it, send it to a gate, paste it into chat or share it with attendees.
2. Personally select the saved file through the local file picker and approve the dedicated owner-controlled import. AES is imported nonextractable; the encryption key is retained only in memory. Importing does not connect a wallet or submit a transaction.
3. Explicitly select an injected API-4 wallet and identify the real local prover configured in Lace. Separately review the encrypted role vault, Preview connection, and private-proof destination. Run the finalized node/indexer read. These checks do not assert wallet funding or independently verify the prover installation.
4. Deploy a new event with a fresh request ID, or join an existing exact trusted contract/event/issuer identity. Do not redeploy an unresolved event. A deployment is accepted only after the SDK's complete successful execution attribution and independent state read at the finalized transaction block. Save/share only its public event manifest.
5. On each bearer’s own device, use the organiser’s exact public event ID and a distinct bearer role file. Derive the genuine Compact public pass commitment. Send only that commitment to the issuer. The issuer approves issuance; it never imports, creates or stores the attendee's bearer capability. Host/Guest labels, capacity and event times are application presentation policies, not restrictions enforced by the original Compact contract.
6. The bearer joins the trusted event with their own capability. Private presentation is explicit and checks independent ACTIVE state. QR is rendered locally with the distinct `guestlist-midnight-v1:` codec. Anyone copying it may redeem first. No QR service or URL receives the capability.
7. A gate operator deploys/configures the durable shared backend described in `gate-service/README.md`. Every physical gate uses that same backend. Its existing owner-held connection file has schema `guestlist-gate-client-v1`, exact service URL, gate ID, and API secret. Personally import that file and review the exact authentication recipient before connecting. The secret remains memory-only and is dropped on Lock/mode exit. Never embed it into an app bundle or localStorage.
8. At check-in the gate opens a public request after independently observing finalized ACTIVE state. The bearer uses that gate's request ID to approve redemption on their own device. Only public request/commitment/transaction identifiers go to the gate. The gate's first successful durable claim verifies transaction attribution, finalized-block USED state and that the redemption followed the ACTIVE baseline. Only that response shows Admitted. Replays/lost-response recovery/status reads never grant a second entry.

## Machine-readable consent and interruption rules

`src/live/consent.ts` exports `CONSENT_REQUIREMENTS`: authority creation is per-action, private file and existing gate-authority import require owner handoff, storage/connection/presentation and private prover/transaction reviews are explicit. `ConsentQueue` stays pending until an actual owner response. There are no unconditional production approval callbacks. Agents must not activate these owner controls during QA or enter private values for the owner.

Lock/mode exit invalidates async session generations, closes sessions and gate clients, discards capabilities/keys and clears private QR. Late responses never reconnect, reveal a credential, restore a joined role, or grant admission. Public request/transaction IDs are preserved as unresolved for read-only recovery.

The controller persists only exact allowlisted public request metadata/receipts and gate contexts in a separate Preview namespace. Secret files, capabilities, keys, labels and provider error payloads never enter that namespace. SDK encrypted IndexedDB provides the durable scoped transaction journal. Pending/unknown transactions block resubmission; read-only reconciliation uses the original owner/event/role/request ID, including across reloads. Corrupt/unavailable history fails closed. Browser profile storage is not multi-device gate coordination or a custody backup.

## Offline build and tests

- `npm run stage:live`: build the single genuine browser ESM/WASM boundary and copy it plus the complete integrity-manifested compiler assets into `public/midnight/`
- `npm run check`, `npm run test:live`: strict application type-check and synthetic controller/custody/race tests
- `npm run test:browser`: genuine SDK offline tests and bundle smoke; this is separate from browser execution/owner network acceptance
- `npm run build`/`dev` stage live assets first. A subpath mount requires adjusting the explicit SDK/assets URLs; the current mount is root-level

Offline synthetic test keys/providers are fixtures only. Browser module-loading QA, owner network acceptance, funding/prover setup and durable backend operation each need their own verified evidence. A built UI or passing synthetic test is not a deployed or end-to-end-tested onchain DApp.

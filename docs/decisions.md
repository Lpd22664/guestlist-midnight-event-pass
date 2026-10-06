# Guestlist design decisions

These records explain the proposed tradeoffs. They do not imply that Archie personally made every implementation choice. The documented human direction is the event-pass concept, a highly polished UI, review of the AI-assisted work, and a later requirement for an Apple-informed interface with formal checks. The Compact fields, domains, and bearer-only redemption choice below have been reconciled with source; successful compilation and live behaviour require separate evidence.

## One event and one issuer

**Choice:** keep event configuration and issuer authority narrow.

**Reason:** a small lifecycle makes the public/private boundary and one-use admission rule explainable and testable.

**Cost:** no tenant isolation, delegated gate staff, independent issuers, key rotation, or production organisational model. Expanding to multiple events needs event-scoped storage, authority, and tests; adding a dropdown alone is insufficient.

## Bearer QR credential

**Choice:** admission authority travels with a random secret in a machine-readable credential.

**Reason:** the attendee does not need an identity-verification flow to present a pass, and the product can demonstrate possession-based eligibility.

**Cost:** a copied QR is a copied capability. This does not prove identity or prevent transfer. The first accepted redemption consumes the shared capability. The current contract deliberately uses bearer-only redemption. Remote self-consumption is possible; gate-authorised redemption is a future alternative for physical admission.

## Contact data outside the ledger

**Choice:** the demo stores invented labels off-chain and has no email field. Any future name/email and contact-to-pass record belongs outside the ledger.

**Reason:** admission validation does not need these fields, so publishing them would create avoidable exposure.

**Cost:** off-chain storage needs its own access, retention, backup, and delivery controls. The organiser can still link a contact to a public commitment.

## Public per-pass state

**Choice:** Compact implements an ACTIVE/USED/REVOKED lifecycle keyed by a pass commitment, with permanent entries and no reissue.

**Reason:** straightforward revocation, one-use semantics, clear operator feedback, and an inspectable contract story.

**Cost:** issuance and use of an individual pass remain linkable. A private membership tree and independently domain-separated nullifier could support a stronger privacy design, but would introduce membership, revocation, and state-synchronisation complexity. This prototype does not claim those guarantees.

## High-entropy digest commitments

**Choice:** use domain-separated derivation from random bearer secrets, with event binding. Compact uses typed three-element vectors containing a padded role domain, event ID, and secret; the demo uses a distinct string hash.

**Reason:** a secret should be difficult to guess, and issuer and attendee roles should not share a derivation domain.

**Cost:** a hash is not automatically a hiding commitment for low-entropy data. The UI simulator's digest must not be presented as a compatible Compact commitment without runtime-backed vectors.

## Local synthetic mode alongside Compact

**Choice:** make the product demonstrable without claiming a real network connection.

**Reason:** a reviewer can inspect the flow even without a wallet, proof server, or funded development account.

**Cost:** the UI and contract can diverge. Maintain explicit labels and separate validation stages. Test the contract using generated runtime artifacts, and verify a future network adapter independently.

## Terminal redemption and revocation

**Choice:** active passes transition once to redeemed or revoked; no undo in this scope.

**Reason:** simple one-use semantics and a clear rejection rule for repeat presentation.

**Cost:** accidental redemption requires a separate replacement process, not silently resetting the pass. A copied pass may be consumed before the intended attendee uses it.

## Proof service and key custody

**Choice:** require a local or explicitly trusted proof service before live integration; keep admission and deployment-maintenance authority conceptually separate.

**Reason:** proving inputs and the ability to change accepted circuit rules are security-relevant.

**Cost:** setup and custody become part of the product experience. Document these before a real pilot. [Official deployment guidance](https://docs.midnight.network/guides/deploy-and-operate), checked 5 October 2026.

## Apple-informed web interface

**Choice:** study Apple Wallet and published Apple interface examples, then adapt hierarchy, restrained surfaces, system-first typography, scoped dialogs, and accessibility into original web components. See [design references](design-references.md).

**Reason:** a coherent interface should make pass presentation and organiser tasks legible with a predictable visual language.

**Cost:** visual resemblance does not provide native platform behaviour, Apple integration, device security, or accessibility conformance. Final rendered checks are required; [the QA checklist](qa-checklist.md) records their status.

## Lifecycle-first interface revision

Product review required a purpose-specific flow while preserving implemented features. The interface was rebuilt around Issue pass → Present pass → Check-in. The organiser starts at credential creation rather than a dashboard. Successful issuance hands off the exact new pass. The attendee screen centres the QR. The entry screen prioritises the credential and an unambiguous admission/rejection result. Search, revocation, activity and connection details moved to secondary tools. KPI cards, the CRM sidebar and promotional slogans were removed. Domain, Compact and SDK rules remain unchanged.

## Supported compile checkpoint, 5 October 2026

The official compiler 0.31.1 release download later became available through a normal authenticated-free public metadata read. Its SHA-256 matched the official asset digest; no access restriction was bypassed. Full compile and negative/runtime tests passed. JS/types, keys and ZKIR are byte-identical to the earlier 0.31.0 outputs, so historical local proof input hashes remain valid. Current reproduction uses 0.31.1; network acceptance is still pending.

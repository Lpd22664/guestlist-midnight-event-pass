# Guestlist product brief

Guestlist is a one-event admission-pass prototype built to explore a narrow Midnight use case: proving that a bearer credential is eligible for one admission without publishing the attendee's name or email. The portfolio story is the relationship between product requirements, public and private data, and credible validation, rather than a claim of production readiness.

## Problem and users

A conventional guest list combines admission status with personal contact information. A gate operator usually needs to know whether a pass is valid and unused, while the organiser may need a separate contact record. Guestlist separates these jobs.

- **Organiser:** issues an admission credential, sees the operational guest list, and revokes a pass when necessary
- **Gate operator:** checks a presented credential and records its use
- **Attendee:** holds a bearer QR credential and presents it at the door
- **Portfolio reviewer:** can run a synthetic demonstration and inspect the contract design, limitations, and validation evidence

The initial scope has one event and one issuer. The interface presents organiser and gate workflows. The current Compact contract authenticates issue/revoke with issuer authority and redemption with bearer possession only; it does not authenticate a separate gate role. Delegated staff permissions are future work.

## Smallest useful flow

The local synthetic demo issues a credential, presents its QR, records one local admission and rejects a replay. The live design separates custody and public coordination:

1. The bearer creates and keeps a fresh random secret on their own device, derives its event-bound Compact commitment and gives only that public commitment to the issuer
2. The authorised issuer issues the commitment; the bearer independently verifies ACTIVE before presenting their private credential
3. The durable gate backend opens a public request after independently observing finalized ACTIVE state
4. The bearer approves redemption on their own device and approved prover; only public identifiers go to the gate
5. The gate independently verifies finalized redemption/USED state and grants once through durable claim logic. Repeat or revoked credentials must refuse admission

The live sequence is implemented, but accepted network circuit lifecycle and gate operation remain pending.

The current demo stores invented display labels and no email field. A future organiser contact record, including names and emails, stays off-chain and is not required to establish admission eligibility. A pass is intentionally a bearer credential: possession does not establish a legal identity or prove that the presenter is the original recipient.

## Scope and acceptance criteria

- Issue, inspect, redeem, and revoke have clear success and failure states
- A malformed credential, wrong event, unknown pass, reused pass, or revoked pass is rejected without leaking its secret in an error
- Redeemed and revoked passes cannot silently return to active
- Issuer-only actions are constrained by contract logic in a real deployment, not by a UI role switch
- The private attendee record is visibly separated from public commitments and status
- Local synthetic behaviour is labelled wherever it could be mistaken for a network transaction
- The layout works on a phone as well as at an organiser's desktop

These are acceptance criteria, not a record of tests already passed. See the repository's final validation evidence before claiming completion.

## Success measures for a future pilot

Measure completion rate and time for issue-to-admission, erroneous rejection rate, repeated-scan handling, and operator understanding of active/redeemed/revoked status. Ask attendees whether they understand that sharing the QR shares admission authority. No pilot results or performance measurements are claimed here.

## Deliberate limits

No payments, NFT marketplace, transfer protocol, identity verification, multi-event tenancy, offline distributed check-in, delegated staff keys, or production recovery flow. Bearer-only contract redemption permits remote self-consumption and does not prove physical presence. The demo's expiry, capacity limit, and Host label are not contract-enforced features. Public pass commitments and state transitions are linkable. The design does not promise anonymity, hide attendance patterns, or prevent the organiser from associating a pass with an off-chain contact.

## Current claim boundary

The runnable local demonstration uses synthetic records. The original Compact contract has full compilation/key-generation evidence, 19 passing generated-runtime tests and six compiler checks. Genuine local issue, redeem and revoke proofs passed official prover self-verification. The owner’s actual Preview deployment was independently verified at canonical finalized block 1169309. Public source 3a18aa7 passed clean installation, offline checks, actual SDK browser runtime and desktop/phone synthetic E2E. [Reviewer status](reviewer-status.md) links each source and its limits. Accepted network circuit lifecycle and live gate admission remain pending; no anonymity guarantee, independent security audit or production suitability is claimed.

Midnight's model supports proving properties of private inputs, but application disclosure choices remain the developer's responsibility. [Official explicit-disclosure guide](https://docs.midnight.network/compact/reference/explicit-disclosure), checked 5 October 2026.

## Current interface

The first task is issuance, not analytics. A successful issue shows its generated QR and an explicit handoff to the holder view. The holder sees the credential front and essential controls. The gate operator checks a pasted credential and receives a clear admitted/rejected result. Management, revocation, activity and technical connection details are secondary. Local demo is a same-browser role simulation. The separate owner-controlled Preview mode uses the genuine SDK; its recorded deployment does not establish a completed network admission lifecycle.

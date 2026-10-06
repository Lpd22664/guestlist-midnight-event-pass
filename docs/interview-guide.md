# Guestlist interview guide

Use this guide to explain the product and inspect its implementation. The [6 October 2026 reviewer status](reviewer-status.md) identifies the checked source, successful CI, local proof evidence and verified Preview deployment. Network lifecycle and live gate acceptance remain pending. Check the final source before naming exact fields, circuit signatures or test results.

## Thirty second explanation

"Guestlist is an AI-assisted one-event admission prototype. In the live design, each bearer keeps a random secret and gives the organiser only its public commitment to issue. The Compact contract constrains issue, one-use redemption and revocation. The local demo uses synthetic data. All three circuits have genuine local proof evidence, and the owner’s Preview deployment is independently verified. Full network admission is still pending. Names and emails stay off-chain, but public status remains linkable."

## What is the public and private flow

The issuer holds a private secret and the contract stores its derived public identifier. Issuance proves the appropriate issuer relationship and creates an active pass commitment. The attendee creates and holds a separate random secret on their own device, and sends only its public commitment to the issuer. At redemption, the prover re-derives the commitment, establishes that it is known and active, and changes the status. Revocation proves issuer authority and disables an active pass.

The current source expresses the claim: "The supplied secret corresponds to a pass issued for this event, and the pass satisfies the circuit's current admission preconditions." The current redemption circuit does not require issuer authority. It does not prove a person's identity, physical presence, or ownership of a particular email address.

In a real deployment, private witnesses are hidden from chain observers unless deliberately exposed. Public ledger state is observable. Private state and witness computation occur off-chain. [Midnight glossary](https://docs.midnight.network/glossary), checked 5 October 2026.

## Why a random secret instead of hashing an email

An email address is guessable. A public digest could be checked against a candidate list. A randomly generated 32-byte secret is the possession credential; the organiser's contact record is separate. A digest of that secret is called a commitment in this app, but that terminology does not imply a randomised commitment primitive or protection for arbitrary low-entropy input.

Compact derives the pass digest with `persistentHash<Vector<3, Bytes<32>>>` over `[pad(32, "midnight:event-pass:bearer:v1"), eventId, bearerSecret]`; the issuer uses a separate `midnight:event-pass:issuer:v1` domain. The simulator instead hashes a demo-only string. Seed secrets are predictable synthetic fixtures; new demo passes use a CSPRNG. Neither the simulator credential nor its digest is a network-compatible pass.

## What does disclose do

`disclose()` tells Compact's compiler that a derived value may cross a public boundary. It is not encryption or a network send by itself. Inspect the surrounding ledger write, exported return, or cross-contract call to understand what becomes public. Keep it close to the intended publication site, after deriving the public identifier rather than on the raw secret. [Compact explicit-disclosure guide](https://docs.midnight.network/compact/reference/explicit-disclosure), checked 5 October 2026.

## Can the frontend lie about the issuer

Yes. A malicious caller can replace the frontend and witness implementation. The issuer check must be an assertion relating a private secret to the fixed public issuer identifier. A selected role or connected wallet is insufficient. `ownPublicKey()` is a witness and must not be used as an authentication shortcut. [Midnight smart-contract security](https://docs.midnight.network/compact/smart-contract-security), checked 5 October 2026.

Be ready to find the assertion and demonstrate an attacker-secret rejection using the generated contract, not merely a hidden button in the UI.

## How is repeated entry prevented

The pass must be active when the authoritative transaction applies, and that same transition records redeemed status. Terminal status prevents a later valid redemption. A green check on a scanner before confirmation is not enough. Concurrent scans and a redeem/revoke race require real-network tests; sequential local tests do not establish distributed gate correctness.

The current contract permits any secret holder to redeem. Acknowledge remote consumption: the proof establishes possession and current eligibility, not physical presence. The implemented durable gate service coordinates public requests and claim-once responses, but its live acceptance is pending. The contract has no gate authorization; a cryptographic gate-authorized policy would require a separately reviewed contract/protocol change.

## What privacy is actually achieved

The ledger need not receive the name, email, or raw bearer secret. It still exposes the commitment, state, and action context in the chosen per-pass design. The organiser can associate a commitment with its off-chain guest record. The displayed bearer QR contains the bearer secret, so anyone who scans or copies it obtains bearer authority. The implemented live gate flow exchanges public identifiers while the bearer proves on their own device and approved prover; it does not require handing that QR to the gate. Screenshots, browser compromise, infrastructure, or timing correlation can defeat the intended confidentiality.

The official security guide describes public circuit/contract identity, ledger-operation arguments, and timing as observable, and treats proving infrastructure as a trust decision. [Security and best practices](https://docs.midnight.network/guides/security-best-practices), checked 5 October 2026.

## Which UI rules are absent from the contract

The UI has an expiry date, a 72-pass limit, Guest/Host labels, and local request idempotency. Compact currently has no expiry or capacity gate and no Host privilege. Its one-use protection is the ACTIVE-state assertion and USED write; it does not use the UI's request ID. Names are synthetic local labels, and the demo has no email field.

## What has really been validated

The recorded evidence includes full compilation with keys, 19 passing generated-runtime tests and six compiler checks. The source SHA-256 matches the build manifest. Genuine local issue, redeem and revoke proofs passed official prover self-verification. Independent official node/indexer reads verified the owner’s actual Preview deployment at finalized block 1169309. Public source `3a18aa7` passed clean installation, offline verification, actual SDK browser runtime and desktop/phone synthetic E2E in [CI run 37451385375](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37451385375). Accepted network circuit lifecycle and live gate admission remain pending. See [reviewer status](reviewer-status.md) and [the QA checklist](qa-checklist.md) for exact evidence and limits.

Read the evidence, then answer in stages:

1. UI build and type checks: cite the actual command and result
2. Local lifecycle and parser tests: state which positive and negative cases were exercised
3. Compact compilation: distinguish generated-runtime output from full proving artifacts
4. Generated-contract tests: distinguish these from a hand-written TypeScript simulator
5. Proof generation: provide its recorded evidence, or say it has not been established
6. Network deployment: provide network, contract address, finalised transaction references, and independent state reads, or say it has not been established
7. Independent security assessment: none is claimed by these documents

There is no benefit in merging these stages into a vague claim that "it works on Midnight."

## What would you improve next

Prioritise accepted network issue/redeem/revoke receipts and independent finalized-state reads, then live durable-gate acceptance and adversarial concurrency/recovery tests. Review issuer recovery/rotation, a stronger gate policy and private-record retention controls before any pilot. If the product needs unlinkable use, revisit the per-pass public state model with membership and nullifier techniques rather than claiming the current design already provides it.

## Who did what

Archie selected the event-pass direction, requested a highly polished UI, and reviewed the work. AI assisted with research, implementation, testing work, and documentation. Describe additional human decisions only if they actually occurred and can be explained. See [AI assistance and ownership](ai-assistance.md).

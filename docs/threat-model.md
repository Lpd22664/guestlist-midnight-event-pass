# Guestlist threat model

This is an application-level risk review and validation plan, not a security audit or proof of safety. It covers a one-event, one-issuer bearer admission design. Controls described as requirements must be checked against the final implementation and tested before use with real attendees.

## Assets and adversaries

Protect issuer authority, pass secrets, attendee contact records, correct admission status, and an honest representation of what was verified. Consider a malicious attendee or custom prover, a QR thief, a chain observer, a compromised organiser/gate device, and an operator of proving or indexing infrastructure.

The official Midnight security guide distinguishes chain observers, malicious provers, and off-chain infrastructure operators. It states that witnesses are prover-controlled and that public ledger operations and timing are observable. [Security and best practices](https://docs.midnight.network/guides/security-best-practices), checked 5 October 2026.

## Trust boundaries

- UI to contract: a caller can bypass every screen and supply their own inputs
- Private device to proof service: private witness inputs enter proving infrastructure
- Attendee to scanner: the bearer credential is intentionally shared with the scanner
- Contact record to public ledger: names and emails must never cross this boundary
- Local simulator to network adapter: simulated success must never imply network confirmation
- Deployment to maintenance authority: control of verifier updates is separate from admission authority

Midnight's deployment guide warns that a proof server sees witness data in the clear. A remotely operated service therefore belongs inside the confidentiality trust boundary. Prefer a locally operated proof server for this design. [Deploying and operating a contract](https://docs.midnight.network/guides/deploy-and-operate), checked 5 October 2026.

## Risks and required checks

| Risk | Consequence | Required control or validation |
| --- | --- | --- |
| Forged organiser role or witness | Unauthorised issue/revoke | Circuit compares a secret-derived issuer identifier with its fixed ledger value; call directly with an attacker secret |
| QR photograph, forwarding, or clipboard theft | Someone else possesses admission authority | Clear bearer warning; private delivery; do not log secrets; treat a lost credential as compromised |
| Replayed redemption | Repeated admission | Active-state assertion and terminal update in one authoritative transaction; test a second call |
| Parallel scans | Two operators believe admission succeeded | Do not admit on local optimistic success; finalisation and conflict handling; test competing transactions on a real network |
| Bearer-only remote consumption | Pass becomes unusable before arrival | Present limitation in current contract; future gate authority would be a policy change |
| Revoke/redeem race | Status shown by a scanner is stale | Authoritative terminal-state check; report confirmed outcome, refresh public state, fail closed on uncertainty |
| Wrong-event credential | A pass is accepted in another context | Event-bound derivation and strict credential event/version validation |
| Guessable pass secret | Commitment can be brute-forced | CSPRNG-generated 32-byte secrets; never derive secrets from names, emails, timestamps, or sequential IDs |
| Hash or encoding mismatch | Valid credential is rejected or wrong identity is checked | Demo string hashing is intentionally incompatible with Compact typed hashing; use generated-runtime vectors for a future adapter |
| Malformed or oversized credential | Crash or denial of service | Bounded parser, strict version and length checks, safe errors; never execute scanned content |
| XSS or compromised dependency | Browser secrets and contacts stolen | Minimal dependency surface, no unsafe HTML, CSP and dependency review before hosting; no real credentials in demo storage |
| Lost issuer secret or device | Administration becomes unavailable | Define encrypted backup and recovery; current one-issuer scope has no recovery guarantee |
| Compromised issuer | Arbitrary issuance/revocation | Separate device custody and operational controls; key rotation and delegated authority are future work |
| Demo state tampering | Fake admission status | Label simulator; use synthetic attendees; never operate a real gate from browser-local state |
| UI-only expiry or capacity mistaken for contract rules | Real passes may outlive the demo cutoff or exceed its count | Current Compact has no expiry/capacity check; add circuit enforcement before claiming these properties |
| Misleading portfolio claims | Reviewer is led to believe unverified security or deployment | Evidence-backed verification record; disclose synthetic mode, unrun stages, and AI assistance |

## Privacy limits

The public commitment is a stable handle for a pass. Its issuance, redemption, and revocation can be linked to each other, the event, and observable timing. A small event or a visible gate queue can make correlation easier. This prototype does not establish an anonymity set or hide which issued pass is used.

The organiser's off-chain mapping may reveal who owns each public commitment. The scanner receives the bearer secret, and proving infrastructure may receive it too. Keeping names and emails out of circuit inputs reduces on-chain exposure; it does not make endpoint devices, contact stores, screenshots, logs, backups, or delivery channels confidential.

Do not hash contact details and describe the result as private. Low-entropy values can be guessed. A fresh random secret is the admission capability; contact details are separate operational data.

## Circuit review focus

`ownPublicKey()` must not be treated as caller authentication. Witnesses and inputs need explicit circuit constraints. Review the actual issue, redeem, and revoke assertions, not just the TypeScript helper that supplies them. [Smart contract security](https://docs.midnight.network/compact/smart-contract-security), checked 5 October 2026.

Inspect every `disclose()` site and exported return. The wrapper permits a value to cross a public boundary; it is not encryption and does not independently publish a value. Only the intended event context, derived identifiers, and state should reach public positions. [Explicit disclosure](https://docs.midnight.network/compact/reference/explicit-disclosure), checked 5 October 2026.

## Source boundaries

The inspected contract uses ACTIVE, USED, and REVOKED. It authenticates issue/revoke through the issuer secret and redeem through the bearer secret only. No exported circuit removes map entries, resets terminal states, rotates authority, enforces capacity, or checks expiry. Source inspection confirms these design choices, not cryptographic proof generation or network behaviour. The local simulator's predictable seed secrets and browser storage are appropriate only for invented demo data.

## Before real use

Require successful full compilation and proof generation, adversarial contract tests, independently observed deployment and finalised lifecycle transactions, concurrency testing, key-custody review, private-store and logging review, and an operational failure/recovery plan. Decide maintenance-authority custody deliberately. A Preview deployment remains a development exercise, not evidence of production safety. No independent audit has been performed or claimed by these documents.

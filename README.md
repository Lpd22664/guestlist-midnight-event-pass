# Guestlist · Private event passes on Midnight

[![Current main branch CI](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/workflows/verify.yml)

An AI-assisted portfolio prototype for a simple question: **can a guest prove they have a valid, unused invitation without putting their name on a public ledger?**

Guestlist pairs an Apple-informed, responsive event interface with an original Compact contract. It is a prototype, not a production admission system, an Apple Wallet integration, or a security-audited product.

## Start here for reviewers

The default app is a **wallet-free synthetic demo**. Run it locally, follow the [three-minute walkthrough](docs/demo-walkthrough.md), then inspect the [original Compact contract](contracts/event-pass.compact) and [interview guide](docs/interview-guide.md).

At the 6 October 2026 checkpoint, [CI passed on source commit `3a18aa7`](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37451385375): clean installation, offline verification, actual SDK browser runtime, and desktop/phone end-to-end flows. [Reviewer status and evidence](docs/reviewer-status.md) separates that synthetic demo, all three genuine local circuit proofs, the independently verified Preview deployment, and the still-pending network lifecycle/gate acceptance. Earlier failed-job emails refer to older runs; the linked successful run identifies the exact source it checked.

Public screenshots appear below. The owner's private hosted preview is not a reviewer demo; the public source, captures and local setup are the review path.

## Guided journey update

The current source separates **Organise an event**, **My pass** and **Run the door**. It carries public event identity through strict invitation links and public QR handoffs. Guests can prepare a request and read compatible public state without connecting a wallet; real redemption still requires the supported Lace/local-prover path and explicit approvals. Password-protected device access can unlock the same authority on return visits, with optional encrypted recovery backups.

[CI passed on the guided-journey application commit](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37616640355): 420 offline tests and 58 desktop/phone browser cases, including native encrypted-vault recovery. The synthetic demo was measured at four primary actions after label entry, with no copying or files. [Implementation, security boundaries and exact validation status](docs/journey-simplification.md). The recorded deployment and original Compact contract are unchanged. These UI and offline checks do not establish a completed live network lifecycle or physical gate acceptance.

## What actually works

- Organiser: issue a synthetic bearer pass, browse/filter guests, revoke an unused pass and inspect its history
- Attendee: view an event pass and a real encoded QR; copy its bearer credential
- Door: paste a credential, check its demo commitment and admit once; reject malformed, wrong-event, used, revoked and expired preview passes
- UI: clear local-preview/network-disconnected labels, loading/rejection/success states, accessible native dialogs, keyboard navigation and reduced-motion support
- Original Compact: issuer-secret authorization, event-bound commitments, one issuance per commitment, bearer-secret redemption, atomic ACTIVE → USED/REVOKED, permanent tombstones
- Contract evidence: actual full compiler output including keys, generated-runtime tests and compiler-negative checks
- Genuine local cryptographic evidence: issue, redeem and revoke proofs generated with the official WASM prover, each passing witness constraints and mandatory cryptographic prover self-verification. A wrong-verifier control rejects. The published ledger WASM structural check is not independent cryptographic proof verification
- Browser integration: actual API-4 wallet/prover providers, authenticated Compact assets, encrypted owner storage and transaction-attributed finalized receipts. Offline evidence and remaining owner/network prerequisites are in `browser-integration/README.md`. The earlier `integration/` Node live adapter is retired and fails closed

**Local demo is the default and uses only synthetic browser state. Midnight Preview mode wires the genuine SDK, owner-operated role custody, wallet/prover reviews, circuit operations, read-only recovery and the gate client. The original contract was actually deployed by its owner on Preview and independently verified. Network issue/redeem/revoke and live gate admission are still in progress, not passed acceptance tests.**

### Verified Preview deployment

- Contract: `856fb78cc68d912c92e1c1bf33afaced96cb35baa5d0973daaab93eaadca0c65`
- Successful deployment transaction: `003ccdf04e97f8670e725cb37d7a1a0603f2d324b997cd9ce7c71a6578683a9954`
- Canonical finalized block: **1169309**; original issue/redeem/revoke verifier keys match
- Independent official node/indexer read, 5 October 2026: [minimal public receipt and state evidence](evidence/testnet/deployment-independent-read.json)
- No owner private recovery file, wallet seed or signing key is included

### Current interface preview

These captures show the guided role entry and **synthetic** admission, not network admission. Desktop/phone role captures come from the successful CI run; admission was separately checked on the owner-private hosted version 12.

![Role-specific Preview entry](evidence/journey-browser/roles-desktop.png)

![Four-action synthetic admission](evidence/journey-browser/demo-admitted-desktop.png)

[Phone role entry](evidence/journey-browser/roles-phone.png) · [Verification, security assumptions and limits](docs/journey-simplification.md)

The `proof-check/` scripts generated real local proofs for all three circuits using public test witnesses. Those are cryptographic prover checks, not wallet-balanced, submitted or network-finalized transactions. See the dated hash-pinned evidence. Never describe live mode capability or a consent dialog as completed deployment.

## Reproduce the browser app

Use Node **24.19.0** with its npm; the app requires **>=24.19.0 <25**. The recorded setup used npm **11.9.0**. Check `node --version` and `npm --version` before installing. Git and access to the public npm registry are needed for a fresh clone. Direct package versions and transitive integrity hashes are pinned in the lockfiles.

No wallet, credentials, funds, prover service or environment variables are needed for the local synthetic demo. The install/start scripts build and stage the genuine SDK and committed public compiler assets; they do not connect a wallet or submit transactions. You do not need to install the Compact compiler to run the app.

```sh
git clone https://github.com/Lpd22664/guestlist-midnight-event-pass.git
cd guestlist-midnight-event-pass
npm ci
npm run install:packages
npm run dev
```

Open the local URL printed by Vite (default `http://127.0.0.1:4173`). Use localhost or HTTPS because the demo needs Web Crypto. No environment variables, credentials or paid services are needed. The synthetic preview clock is intentionally fixed at 5 October 2026, 17:00 UTC, so the portfolio remains replayable. It is not a real admission time check.

```sh
npm test             # synthetic domain/service + live-controller offline tests
npm run check        # TypeScript, including unit/UI test sources
npm run build        # typecheck + static production build
npm run verify:offline # all active offline layers, legacy retirement, hashes/audit patterns/build
npm run verify:compiler # installed official 0.31.1 compiler + negative/runtime tests
npm run test:e2e     # separate desktop/phone browser flows
```

The optional browser checks use the pinned Playwright package. After the installs above, select its Chromium executable for both suites:

```sh
npx playwright install chromium
export CHROMIUM_PATH="$(node --input-type=module -e 'import { chromium } from "@playwright/test"; console.log(chromium.executablePath())')"
export CHROMIUM_EXECUTABLE="$CHROMIUM_PATH"
npm --prefix browser-integration run test:browser
npm run test:e2e
```

On Linux, missing browser system dependencies may require `npx playwright install --with-deps chromium`, which installs OS packages and may ask for administrator access. CI uses that Linux setup. With neither executable variable set, each suite defaults to `/usr/bin/chromium`. Root E2E starts Vite automatically unless `GUESTLIST_TEST_URL` supplies an existing origin. Keep any private origin private and accessible only through its authorized account. See the [current QA checkpoint](docs/qa-checklist.md#current-public-checkpoint-6-october-2026) for recorded outcomes and the remaining limits.

## Reproduce the actual contract

```sh
npm --prefix contracts ci --ignore-scripts
npm run test:contract
```

The generated JS is executed with official Compact runtime **0.16.0**. To rebuild source with the tested official compiler **0.31.1**:

```sh
COMPACTC=/absolute/path/to/compactc npm run compile:contract
COMPACTC=/absolute/path/to/compactc npm run test:compiler
```

The current official support-matrix compiler **0.31.1** was actually downloaded from its official release, checksum-verified and used for a full successful compilation. Its JS/types, keys and ZKIR match the earlier 0.31.0 artifacts byte for byte; the historical local proof remains correctly attributed. Matching pins and local success are not deployment validation. See `contracts/README.md` for exact versions, comparison hashes, writable-cache setup and build evidence.

## Public vs private

Live-contract public state: event ID, issuer commitment, permanent pass commitment/status entries and aggregate counts. The pass commitment is event- and domain-bound.

Private inputs: the issuer credential secret and bearer credential secret. Names and emails are not contract inputs. A scanner receiving a bearer QR sees the secret; proof infrastructure may also see private witness inputs. Public commitments, state transitions, timing and transaction metadata remain linkable. **Offchain names are not a guarantee of anonymous attendance.**

The browser-only adapter uses an explicitly different SHA-256 demo encoding, not Compact `persistentHash`. Never carry its fixtures or credentials into a network deployment. It stores synthetic labels and secrets in this browser’s local storage. That storage is not a secure real-credential vault.

## Important limits

- Anyone with a copied bearer QR could redeem first; the contract does not establish named identity, physical presence, scanner authorization or nontransferability
- Bearers can consume a pass remotely; a real gate must wait for a finalized accepted transaction and independently read confirmed state
- Two stale local ACTIVE snapshots can both prepare successfully; local computation is not network concurrency protection
- Demo expiry, 72-person capacity, Guest/Host labels and request idempotency are UI rules. The current Compact contract does not enforce them
- Compact provides no issuer-secret rotation; losing the sole issuer credential and all private backups prevents further issuance/revocation
- All three local WASM circuit proofs passed built-in cryptographic prover self-verification. The separate ledger WASM only performs structural checks; its synthetic transaction fixture disables fee balancing. The owner reported local prover8.1.0 and test funding; original deployment/finality is independently verified. Network circuit lifecycle and operational gate acceptance remain unverified
- Gate-service enforces one durable grant across local processes, but the unchanged bearer contract cannot cryptographically distinguish self-consumption after an authenticated gate opens; physical entry is an operational trust boundary
- A lost grant response is never automatically re-admitted. Gate reachability/TLS, authentication authority and consistent durable backup are owner-controlled deployment steps

## Product and interview material

- [Reviewer status and evidence](docs/reviewer-status.md)
- [Product brief](docs/product-brief.md)
- [Architecture and private/public flow](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Decision log](docs/decisions.md)
- [Apple product references](docs/design-references.md)
- [QA checklist and evidence](docs/qa-checklist.md)
- [Owner Preview setup and release gate](docs/owner-testnet-setup.md)
- [Genuine local proof reproduction](proof-check/README.md)
- [Live Preview flow](docs/live-preview.md)
- [Durable gate service](gate-service/README.md)
- [Three-minute demo](docs/demo-walkthrough.md)
- [Interview explanation](docs/interview-guide.md)
- [Honest human/AI attribution](docs/ai-assistance.md)

Archie chose the event-pass project, requested an Apple-informed polished interface and directed the portfolio outcome. AI assisted research, original contract/UI/integration implementation, tests and documentation. Further human review/understanding and complete network lifecycle acceptance remain separate milestones. Do not claim independent manual authorship, security-audited production readiness or a completed gate demonstration from this repository.

## Rights and third-party dependencies

No open-source license grant for the original project has been selected. Dependencies retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). Apple images, logos, fonts and product code are not bundled. Apple products are references only. No Apple or Midnight endorsement is implied.

## Current release scope

The reviewed recovery picker restores only empty public metadata after owner approval. Shared public request history uses atomic native Web Locks, monotonic receipts and exact-scope read-only journal recovery; there is no unlocked production fallback. The gate service has offline tested owner-only provisioning and durable claim logic, but **live acceptance remains unverified**. The gate now uses a bounded genuine as-of finalized-state reader instead of the SDK's exact-action-block lookup. The original Preview contract passed its public read-only anchor/key check on 7 October; [repair evidence and limitations](gate-service/README.md#as-of-finalized-state-repair-7-october-2026) distinguish that from owner acceptance. The release does not claim a working physical gate before that boundary and owner infrastructure are accepted.

# Guestlist verification checklist

This checklist separates required checks from recorded outcomes. Current manual browser outcomes are dated below; partial coverage and unrun stages remain explicit. Contract outcomes below are backed by existing compiler/runtime logs and a source-matched build manifest inspected on 5 October 2026. Passing one layer does not imply the others passed.

## Recording a result

Use PASS, FAIL, BLOCKED, NOT RUN, or NOT APPLICABLE. Record the exact source revision or hash, command/browser version, viewport, observed outcome, and screenshot or log path. A screenshot establishes appearance at that moment, not lifecycle correctness. Rerun affected checks after later source changes. Never mark an untested feature as passing.

## Visual and responsive checks

| Required check | Acceptance criterion | Current status |
| --- | --- | --- |
| Desktop visual review | Inspect issue, guest list, attendee pass, check-in, activity, connection and dialogs | PASS in supported cloud Chrome at 1180×757 for inspected lifecycle views; exact 1440×900 coverage NOT RUN. [Native issue](../evidence/current-browser/issue.png) |
| Phone visual review | Inspect key views at 390/375/320 CSS widths | PASS for tested CSS-frame layouts and long labels; physical-device coverage NOT RUN. [Native pass](../evidence/current-browser/mobile-pass-390.png) |
| No accidental overflow | No clipped text, inaccessible controls, overlapping content, or page-level horizontal scroll; intentional table scrolling must be usable | PASS for tested long-label list at 320/375/390 and enlarged issue/pass/check-in; other views not a comprehensive overflow audit |
| Coherent Apple-informed hierarchy | System-first typography, legible metadata, restrained surfaces, consistent radius/spacing tokens, scannable pass front | PASS, visually inspected original lifecycle-first UI against documented Apple references; subjective design review |
| Zoom and longer content | At 200% text enlargement, retain primary actions and meaningful content; long labels wrap safely | PASS for 9 issue/pass/check-in × 320/390/1280 combinations. Native browser zoom NOT RUN. [Metrics](../evidence/current-browser/text-and-skip.json) |
| QR rendering | QR is generated from the exact selected synthetic credential with quiet space and clear contrast; decode its rendered image and compare payload | PASS, actual rendered 252×252 QR decoded to the selected public synthetic fixture |

## Interaction and accessibility checks

| Required check | Acceptance criterion | Current status |
| --- | --- | --- |
| Key navigation flows | Primary issue → present → check-in and secondary management open correctly without stale backdrops | PASS for manual lifecycle and modal checks; standalone Playwright execution BLOCKED |
| Loading and repeat clicks | Visible textual pending state, disabled dependent controls, and no duplicate issuance/redemption from rapid repeated submission | PASS for manual double-click issue/admit, offline idempotency and 20-service shared-lock stress; delayed real-network flows NOT RUN |
| Empty states | No search results and no attendee pass remain understandable with a useful next action; test actual empty-data behaviour separately from filtering | PASS for no-result search and unconfigured live setup; local zero-pass state covered offline, not separately verified manually |
| Error states | Invalid form and credential, wrong event, used, revoked, expired, and storage failure show clear feedback without changing unrelated state or exposing secrets | PASS for tested browser terminal/malformed cases and offline parser/storage failures; complete rendered storage-error audit NOT RUN |
| Wallet disconnected | Unconfigured live setup shows disconnected state and disables dependent operations without false chain success | PASS in cloud preview before owner setup; no owner wallet operation was part of independent UI QA |
| Keyboard operation | Tab/Shift-Tab order is usable; Enter/Space activate controls; visible focus is unobscured; dialogs contain focus, Escape/Cancel close appropriately, and focus returns | PASS for first-Tab/skip, top-level Escape and nested revoke-cancel focus return; complete keyboard-only and screen-reader audit NOT RUN |
| Names and announcements | Inputs and icon controls have meaningful accessible names; results/errors are announced; statuses remain understandable without colour | NOT RUN in this record |
| Contrast | Measure meaningful text/background pairs, status labels, placeholders, focus rings, and controls; project target is at least 4.5:1 for ordinary text | PASS for 32 designated static palette pairs; rendered audit NOT RUN. [Evidence](../evidence/palette-contrast.json) |
| Touch targets | Measure at least 44 by 44 CSS-pixel hit areas for mobile actions, with adequate spacing; include small row/close/navigation controls | PASS for visible controls measured at 1180×757; complete mobile hit-area audit NOT RUN |
| Reduced motion | Under prefers-reduced-motion, remove decorative/continuous animation and transform effects; pending and outcome text remains visible | NOT RUN in this record |
| Destructive dismissal | Keep pass/Cancel do not revoke; Escape/backdrop/Close do not submit a mutation; busy dismissal does not imply cancellation of an action already in progress | PASS for actual revoke cancellation and dialog focus; live lock/late-result fail-close covered offline, real signing interruption NOT RUN |

The thresholds and behaviours are project acceptance criteria informed by [Apple's accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion). They are not a claim of a complete WCAG or assistive-technology audit.

## Local synthetic lifecycle checks

| Required check | Acceptance criterion | Current status |
| --- | --- | --- |
| Issue | Invented label creates one pass; invalid label is rejected; newly generated secret uses CSPRNG; duplicate credential is rejected | NOT RUN in this record |
| Present and copy | Selected attendee displays the matching QR/credential; copy uses the exact credential; a failed clipboard operation has understandable fallback | NOT RUN in this record |
| Redeem | Valid ready pass becomes used exactly once, updates local counters/activity, and returns a clearly local receipt | NOT RUN in this record |
| Used pass | A repeat attempt rejects and preserves state/counters; idempotent same request returns its prior receipt without a second mutation | NOT RUN in this record |
| Revoked pass | Confirmation changes only the chosen ready pass; revoked redemption and reissue fail | NOT RUN in this record |
| Expired pass | A ready pass past the simulator cutoff is rejected; label this as a client-clock demo rule absent from Compact | NOT RUN in this record |
| Parser bounds and event binding | Malformed, oversized, wrong-version, wrong-mode, invalid-secret, wrong-event, and unknown credentials reject safely | NOT RUN in this record |
| Reload and multiple local tabs | Valid local state survives reload; unavailable/corrupt storage gives truthful feedback; Web Locks path serialises supported same-origin tabs | NOT RUN in this record |
| Capacity and presentation labels | Demo capacity is enforced locally; Guest/Host remains presentation only and is not represented as contract authorisation | NOT RUN in this record |
| Reset | Reset affects only synthetic local data after confirmation and restores fixtures; no network or remote-state reset is implied | NOT RUN in this record |

## Build and contract evidence

| Layer | Recorded result | Evidence or remaining work |
| --- | --- | --- |
| React/TypeScript check, local tests, production build | PASS for current source; baseline UI 6845df61 plus provider drift repair below | [Aggregate output](../evidence/offline-verification-output.txt): 197 root + 19 contract + 59 SDK + 75 gate + 4 retired guards = 354 tests |
| Browser end-to-end checks | Manual scoped checks PASS; standalone Playwright BLOCKED | Dated checkpoints below and [SDK screenshot](../evidence/current-browser/sdk-public-assets.png); 22 configured Playwright cases parsed, not executed |
| Full Compact compilation and key generation | PASS in recorded log | [Full compile output](../contracts/evidence/full-compile-output.txt); prover/verifier keys and ZKIR generated for issue/revoke/redeem |
| Generated Compact runtime tests | PASS, 19 of 19 | [Runtime test output](../contracts/evidence/runtime-test-output.txt); includes issuer/bearer attacks, terminal states, reissue, event binding, public-state boundaries, and stale-snapshot limitation |
| Actual compiler negative tests | PASS, 6 of 6 | [Compiler test output](../contracts/evidence/compiler-test-output.txt); rejects sealed-field mutation, raw secret disclosure, and dishonest pure annotation |
| Source/artifact identity | Manifest SHA-256 matches inspected source | [Build manifest](../contracts/evidence/build-manifest.json); source hash 18e896fd19ad963e9b9b612f640b0da3350bff73937f789d57f7d60096e013b0 |
| Toolchain | Recorded actual pair, not a compatibility certification | Compact 0.31.1, language 0.23.0, compact-runtime 0.16.0; project override for onchain-runtime-v3 3.0.0. Review pins and the official support matrix before live integration |

## Real Midnight integration remains unverified

- PASS for all 3 local circuits: real issue, redeem and revoke WASM proofs each returned 4,501 bytes after witness checks and mandatory cryptographic prover self-verification. These are not accepted network transactions. See [all-circuit evidence](../proof-check/evidence/all-circuit-proof-result.json)
- LIMITATION VERIFIED: the published ledger WASM has proof-verifying disabled. Its structural `wellFormed` check accepts a proof mutation, so it is not independent cryptographic verification. The official prover self-check passed and a genuine wrong-verifier negative control rejected. Fee balancing was disabled. See [proof evidence](../proof-check/README.md)
- NOT RUN: connect a real wallet and compatible providers on the explicitly selected network
- NOT RUN: deploy to Midnight Preview and record the contract address plus deployment transaction
- NOT RUN: finalised issue, redeem, rejected repeat, and revoke lifecycle transactions with independent public-state reads
- NOT RUN: simultaneous scanner attempts, redeem/revoke conflicts, delayed indexer state, transaction rejection, and uncertain submission outcomes
- NOT RUN: operational key custody/recovery review, private proving-infrastructure review, and independent security assessment

Generated keys and successful local runtime calls do not establish proof generation, Preview deployment, consensus finality, physical attendance, or production safety. The existing bearer-only contract permits remote consumption and does not enforce the demo's expiry or capacity rules.

## Current browser access limitation, 5 October 2026

Local browser access was blocked in this execution environment; a Chromium process could not start because the command sandbox disallowed its required socket. The approved synthetic-only private preview deployed successfully. The owner approved the specific ChatGPT profile-sharing sign-in consent. A single normal same-account retry resolved the initial callback loop and browser access was verified. UI outcomes below require actual screenshot/interaction evidence; source inspection and unit tests are not substitutes.

The 125 unit tests cover issuance/authorization, parser bounds, event binding, terminal used/revoked/expired states, capacity, idempotency, rapid queued operations, local-storage failures/recovery, resync/reset and the Web Locks path. Three found regressions were fixed: malformed request storage, inherited request-ID properties and stale persisted data overwriting unsaved in-memory actions. These are unit-level results, not browser or network verification.

The production-dependency registry audit recorded zero known vulnerabilities for the pinned browser dependencies at the time checked. This is a dependency-database result, not an app security audit. [Audit output](../evidence/production-dependency-audit.json).

## Genuine local proof checkpoint

On 5 October 2026, the official ZKIR-v2 WASM prover generated an issue proof from the original compiled circuit and synthetic private witnesses. A second proof was bound to an in-memory synthetic contract call, then the ledger verifier returned VerifiedTransaction with verification flags enabled. An initial mutated proof byte was also accepted, so that result does not yet establish independent cryptographic verification. The official prover’s built-in self-verification is supported by upstream source. Fee balancing was disabled because the fixture has no funds. No node submission, wallet transaction, real deployment or consensus finality occurred. Reproduction and exact evidence live under proof-check/.

## Lifecycle-first revision

The dashboard-first UI screenshots and earlier manual UI results are historical and do not validate the rebuilt interface. The revised source opens on issue, hands off the exact created pass to presentation, and keeps gate admission/rejection as the core third task. Its final browser results must be recorded separately. Domain/service tests include the stress-review repairs and pass 125/125; typecheck and production build pass in the current logs. The Playwright source suite now covers the rebuilt lifecycle, secondary management, terminal states, sheet dismissal, route history and honest connection state. Its standalone browser execution remains blocked by this environment's browser-launch restriction; manual cloud-browser checks are reported separately.

## Independent stress review, 5 October 2026

Source checkpoint `89c57bb7f467985e197e1deadf2dd176ec0154bd` is saved privately, not on GitHub. The review passed 3,000 malformed inputs, 2,500 random transition checks and 20 shared-lock scanner attempts in separate scripts. It found and reproduced fixed-calendar expiry, reset revision collision/data loss, missing dialog focus return, and unsafe legacy Node transaction attribution. The first two repairs passed separate source-level regressions. Legacy live entry points now fail closed (4 retirement tests). Dialog and long-label responsive repairs still require final deployed-browser rechecks. Root and active browser package are pinned to Vite 7.3.6; full dependency audits report zero findings in their dated JSON. These checks are not a security audit or live-network acceptance.

Current supported full Compact 0.31.1 compilation and six negative compiler checks passed. All JS/types, keys and ZKIR match the original 0.31.0 proof inputs byte for byte; metadata/source-map paths are the only differences. The original proof run remains attributed to 0.31.0.

## Aggregate reproduction and CI

`npm run verify:offline` checks root TypeScript and all demo/live offline tests, the generated Compact runtime, active browser provider/type/bundle tests, gate SQLite/API tests, retired Node fail-closed guards, artifact hashes, secret-pattern scan, palette checks and production build. It does not silently claim compiler, proof generation, Chromium, wallet or network execution. `npm run verify:compiler` needs the installed official compiler. `npm run test:e2e` is separate. The committed GitHub workflow is prepared but **NOT RUN** before publication; its mere existence is not CI evidence. It has read-only repository permissions and no deployment, wallet or secret setup.

## Verified browser checkpoint: 07bbaa03, 5 October 2026 19:42 UTC

Independent supported cloud Chrome checks passed browser ESM/WASM import, the genuine Compact commitment fixture, and SHA/size-authenticated 2,119-byte verifier key (compiler 0.31.1/runtime0.16.0). Same-origin private-host auth works; external cookies are omitted and redirects/hash failures still reject. No wallet, owner key, prover or chain action occurred.

Manual lifecycle/replay/revocation/terminal rejection, top-level and nested modal focus, mobile long-label containment at 320/375/390 CSS frames, and live disconnected/empty/Entry closed views passed. Actual mobile client/scroll widths matched at 305/360/375 pixels. These are browser CSS tests, not physical-device or assistive-technology certification. Screenshots show actual synthetic UI; Admitted is explicitly local demo.

Source suites passed 158 root (including 33 live),19 generated contract runtime,57 active SDK,47 gate,4 retired guards. Six current real compiler checks and all 3 current real local circuit proofs passed separately. An independent 16-process durable SQLite test granted once and rejected 15 replays. None of those fixture tests establishes chain consensus/finality.

A final focused contrast check corrected input hints, waiting copy, filter counts and pass-ID copy, bringing 32 designated normal-text pairs above 4.5:1. The complete rendered/gradient/assistive-technology audit remains NOT RUN. The new Text 200% harness and skip-link route-preservation repair require their own final manual recheck. The Playwright list command parses 22 configured cases successfully, but execution remains infrastructure-blocked; listing is not a pass. GitHub CI and real funded owner acceptance are not run.

## Final accessibility source checkpoint: 6845df61

Actual same-origin rendered text enlargement passed all nine combinations (issue/pass/check-in × 320/390/1280 CSS widths), with computed root font 32px and no app page-level overflow/clipped text detected. This is 200% text enlargement, not native browser zoom or device certification. The first Tab on a fresh attendee route lands Skip to content; Enter focuses MAIN#main while preserving #wallet/Present your pass. Live first-Tab and skip from the non-secret presentation view also passed; MAIN#live-main is focused and the view stays unchanged. The live heading distinguishes Owner-reviewed event identity from a verified joined/finalized Preview event.

## Owner-reported setup and independent node identity check

The owner subsequently reported funded Preview tNIGHT/tDUST and personally created/imported issuer recovery authority, approved the scoped wallet/vault/prover setup and read a node finalized head. No recovery file or key was provided to this build environment.

At block 1168785, owner-reported hash 0xabf2768a4aaf03cf732655718f307c99b9984945088ba2cb8bcf45353bf40f05 exactly matches the official Preview RPC’s canonical block at that height. Independent HTTP and WSS public RPC reads report Midnight Preview, node 1.0.400-c338b9ac, active runtime specVersion 1000300 and transactionVersion 3. The owner’s reported node-binary string 2.1.0-00000000000 differs from these public-service reads; its cause is not established. A binary version alone does not identify an active ledger fork. The official indexer API v4 independently returned that same height/hash, so the official public services agree. Exact owner endpoint/prover version still need their own checks. This is public-node evidence only, not contract deployment, proof/fee validation, indexer-event verification or on-chain admission. See evidence/preview-owner-node-check.json.

## Additional provider drift regression

An adversarial fixture that reuses and mutates its configuration object could move the lower-level provider baseline. Validation now snapshots and freezes that approved configuration, including before asynchronous proving consent. Two new regressions pass: consumer mutation cannot alter the approved snapshot, and in-place wallet endpoint drift rejects before any private transaction proving. The active SDK suite now has 59 passing offline tests; no owner operation was involved. This is additional source hardening, not evidence about a malicious wallet or a live service change.

## Current browser SDK checkpoint: 1edf2dfc

On 5 October 2026 at 20:55 UTC, actual supported cloud Chrome passed the revised ESM/WASM import, genuine Compact commitment and authenticated 2,119-byte public issue verifier. The two immutable-configuration regressions passed an independent A/B source reproduction and the 59-test SDK suite. No owner wallet/custody/proof/signature/transaction action was taken by browser QA. The original lifecycle/UI and 200% text checkpoints remain applicable because the revised code changes only the provider baseline. [Native capture](../evidence/current-browser/sdk-public-assets.png).

The owner reported localhost refusing the prover health/version request. No working local prover or installation is inferred; owner-local installation/startup remains required. For the confirmed CachyOS machine, [verified distro-specific preparation](owner-cachyos-prover.md) is available. It has not been executed by this build environment.

## Genuine Preview deployment checkpoint

On 5 October 2026 the owner personally deployed the original contract through the live UI. Independent **read-only** official Preview indexer/node checks at 21:18:21 UTC verified contract `856fb78cc68d912c92e1c1bf33afaced96cb35baa5d0973daaab93eaadca0c65`, successful deployment transaction `003ccdf04e97f8670e725cb37d7a1a0603f2d324b997cd9ce7c71a6578683a9954` and canonical finalized block **1169309**. The exact public deploy action/event/issuer and pinned state were checked; all three original verifier keys match. Initial issued/redeemed/revoked counts are 0/0/0. [Independent evidence](../evidence/testnet/deployment-independent-read.json).

The owner separately reported health OK/version8.1.0 for the local prover. This process did not access their loopback service, private recovery file or wallet and submitted no transaction. Deployment verification does not establish an accepted issue/redeem/revoke circuit, physical admission or the full live lifecycle. Those stages remain pending. The unidentified attachment accompanying a node report was not opened.

## Deadline portfolio checkpoint

The recovery picker and atomic public-history fixes passed strict typing and 197 root tests (72 live), including the original stale issuer/bearer loss, scoped missing-row recovery and cancel/reconnect availability repros. Independent review rechecked those exact failures. Gate setup/launcher has75 offline tests. The genuine deployment is preserved; no new issuer authority or deployment is required to resume. Full network circuit lifecycle/gate acceptance and GitHub CI remain pending. The true as-of gate baseline reader is being repaired separately after an actual public API skipped-action-block test returned null; no latest-state fallback or live gate success is claimed.

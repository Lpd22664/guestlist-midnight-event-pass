# Guestlist reviewer status

Checked 6 October 2026. This page records evidence for [public source commit `3a18aa7bbe22985997a2e884f5c46128390e1011`](https://github.com/Lpd22664/guestlist-midnight-event-pass/commit/3a18aa7bbe22985997a2e884f5c46128390e1011). Later documentation or code revisions need their own CI result before being described as checked.

## What a reviewer can run

Follow the [README quickstart](../README.md#reproduce-the-browser-app) and [three-minute demo](demo-walkthrough.md). Local demo is the default. It uses synthetic browser state and needs no wallet, credentials, funds, prover service or environment variables. Its fixed clock is 5 October 2026 at 17:00 UTC. Its SHA-256 commitment and `guestlist-demo:` credential are deliberately distinct from Compact and Preview credentials.

[Issue screenshot](../evidence/current-browser/issue.png), [synthetic admission screenshot](../evidence/current-browser/demo-admission.png), and [390px pass screenshot](../evidence/current-browser/mobile-pass-390.png) are public captures. The owner's private hosted preview remains private; it is not the reviewer access route.

## Recorded evidence

- **CI passed:** [run 37451385375](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37451385375) checked the exact source above. Clean `npm ci`, package installation, `verify:offline`, actual SDK browser runtime, and desktop/phone synthetic E2E steps succeeded. CI did not use a wallet or prove network admission.
- **Original Compact contract:** [source](../contracts/event-pass.compact), [full compilation](../contracts/evidence/full-compile-output.txt), [19 generated-runtime tests](../contracts/evidence/runtime-test-output.txt), and [six compiler checks](../contracts/evidence/compiler-test-output.txt). Tested compiler 0.31.1 and runtime 0.16.0. Compiler execution is separate from CI's offline aggregate.
- **Three genuine local proofs:** issue, redeem and revoke each passed witness constraints and mandatory official WASM prover cryptographic self-verification. The wrong-verifier control rejected. [Results and hashes](../proof-check/evidence/all-circuit-proof-result.json), [reproduction and limits](../proof-check/README.md). The published ledger WASM check is structural, not independent cryptographic verification. These public test fixtures were not wallet-balanced or submitted to the network.
- **Actual Preview deployment:** on 5 October 2026, the owner deployed contract `856fb78cc68d912c92e1c1bf33afaced96cb35baa5d0973daaab93eaadca0c65`. Independent official node/indexer reads verified successful transaction `003ccdf04e97f8670e725cb37d7a1a0603f2d324b997cd9ce7c71a6578683a9954`, canonical finalized block **1169309**, and all three original verifier keys. Initial issued/redeemed/revoked counts were 0/0/0. [Public receipt and state evidence](../evidence/testnet/deployment-independent-read.json).

## Still pending

Accepted network issue → redeem → USED, repeat refusal, revoke → refused redemption, concurrency/race and uncertain-submission recovery, and live durable-gate admission have not passed end-to-end acceptance. A deployment receipt or a green synthetic admission does not establish those outcomes. Gate operation also depends on the owner-hosted backend, trusted finalized-state readers, private authentication, and durable storage. [QA history and limits](qa-checklist.md), [owner release gate](owner-testnet-setup.md), [gate service](../gate-service/README.md).

The live custody design keeps each bearer secret on the bearer's device and approved prover. The issuer receives only its public commitment; the gate receives public request, commitment and transaction identifiers. A copied bearer credential can still be consumed remotely, and public commitments, state and timing remain linkable. No anonymity guarantee, independent security audit or production readiness is claimed.

## Earlier failed-job emails

The earlier [39275ac run](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37446919948), [d98a022 run](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37449469172), and [d8e6fff run](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37450445007) failed. At this checkpoint, the newest run was the successful `3a18aa7` run above. An email about an older run retains that historical outcome; compare its run and commit with the current check rather than treating the email as current repository status. [All workflow runs](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions).

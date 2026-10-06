# Owner Preview setup and release gate

Checked 5 October 2026. This checklist is preparation, not evidence that any owner action or deployment happened. No recovery file, wallet address or private key belongs in this repository.

## On the owner's computer

1. Use official Lace with Midnight **Preview** selected. Keep the wallet recovery phrase entirely under your control. Wallet signing proves control of that wallet, not a guest's identity.
2. Request free Preview tNIGHT at the official faucet, using your Preview unshielded address. Confirm it actually arrives before proceeding. In Lace, **Generate tDUST → Review transaction → Confirm** registers the tokens for DUST generation. Check the tank, rather than assuming registration means usable fees. [Funding guide](https://docs.midnight.network/guides/acquire-tokens)
3. First inspect the actual local prover destination already configured in Lace. If a compatible prover is running, check its health/version without changing settings or installing another copy. Only if a local prover is needed, with Docker already installed or separately approved, run `docker compose -f ops/proof-server.yml up -d` on the same machine as Lace. It pins proof-server **8.1.0** and binds only loopback port 6300. In Lace's Midnight settings, use its supported local proof server. Verify `http://localhost:6300/health`, `/version` and `/ready`. Initial public parameter download may take time; your private witnesses subsequently go to this local service. [Proof server](https://docs.midnight.network/guides/run-proof-server), [local proving](https://docs.midnight.network/guides/local-proving)
4. Fresh live-network tDUST may take time to accrue; the official local-proving guide estimates roughly 12 hours, rather than instant availability. Do not purchase anything or use mainnet to work around this. [DUST timing](https://docs.midnight.network/guides/local-proving)
5. Open Guestlist on your own machine in the browser with Lace installed. Review the **Midnight Preview** mode before creating/importing a role recovery file. You personally perform custody provisioning and any private file selection. Role files contain credential authority; keep them private, outside the repo and cloud chat. The issuer and bearer vaults must remain separate. Any persistent-key setup requires the specific action-time approval; the assistant does not generate or import your authority.
6. Review wallet connection, IndexedDB persistence, private prover destination and DUST implications. Approve each deployment/circuit operation in its own review and wallet prompt. A preview UI consent checkbox is not evidence you signed a transaction.

For a confirmed CachyOS machine without Docker, use the [distro-specific owner-local guide](owner-cachyos-prover.md); it does not add Docker-group membership or autostart.

## Before claiming network readiness

The official matrix currently pairs compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, connector **4.0.1**, ledger **8.1.0** and prover **8.1.0**. Full compilation with 0.31.1 has passed; JS/types, keys and ZKIR are byte-identical to the original 0.31.0 proof artifacts. The rebuilt browser asset manifest passed an actual browser hash/size check at source 07bbaa03; the active private UI is 6845df61. This verifies public build assets, not the owner-selected prover or a network operation. [Compatibility matrix](https://docs.midnight.network/relnotes/support-matrix)

The owner-managed gate service also needs a local deployment, private authentication setup and durable SQLite storage. Its readers must verify actual attributed finality, never trust client success text. A physical gate cannot atomically coordinate human entry with delivery of an HTTP response; uncertain grants require supervised reconciliation. The bearer contract still permits remote self-consumption.

Required acceptance evidence: public contract address, finalized deployment receipt, issue → redeem → USED independent block-state reads, repeat refusal, revoke → refused redemption, multi-gate claim-once, delayed/rejected/unknown submission recovery. Never resubmit an unknown request blindly. Until this is recorded, network deployment and full admission readiness remain **NOT RUN**.

## Dated setup observation

On 5 October the owner reported free Preview funding, tDUST and local issuer custody setup. An owner-reported finalized block hash independently matched the official Preview RPC at height 1168785. The precise owner endpoint and local prover readiness still need validation; no deployment or accepted circuit receipt is recorded. See [node evidence](../evidence/preview-owner-node-check.json).

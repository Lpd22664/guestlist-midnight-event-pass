# Three-minute Guestlist demo

Run the [local app](../README.md#reproduce-the-browser-app), keep **Local demo** selected, and use an invented guest label. No wallet or Preview setup is needed. These timings are a presentation guide, not measured completion times. The final evidence step is separate from the synthetic interaction.

## Before the timer

If the browser has previous demo data, select **Reset demo → Reset demo** in its confirmation. This restores the original 18 synthetic guests. Select **Issue pass** to start. The reset affects only synthetic browser data. The demo clock stays fixed at 5 October 2026, 17:00 UTC.

## 0:00–0:35 Issue

Enter **Morgan Harper**, leave Guest selected, and select **Create pass**. The created pass number and a real encoded QR appear together. Select **Present this pass** to open that exact credential.

Suggested explanation: “This is a synthetic pass in browser storage. Names and emails are not inputs to the Compact contract.”

## 0:35–1:00 Present

Show the event, label, status and QR in the holder view. **Pass details** holds the commitment; **Copy credential** exposes the same synthetic bearer credential used by the QR.

Explain that anyone with a copied bearer credential could use it first. Public commitments and status changes remain linkable. In the live design, the bearer keeps their own secret and gives the issuer only a public Compact commitment; this same-browser demo simulates the roles.

## 1:00–1:40 Admit and reject a replay

Open **Preview tools → Try check-in**, then select **Check in**. The app shows **Admitted**, records one local admission, and marks the pass used.

Select **Check another pass → Use a demo pass**, choose **Morgan Harper · Checked in**, select **Use pass**, then **Check in** again. **Already used** and **No entry recorded** show the refused replay.

Suggested explanation: “This result is local. A live gate must independently verify a finalized redemption and claim entry once through the shared backend.”

## 1:40–2:15 Revoke a different unused pass

Open **More options → Issued passes**, find **Sam Rivers**, open its pass, and select **Revoke**. **Keep pass** cancels. Open Revoke again and select **Revoke pass** to confirm. Reopen the pass to show its terminal **Revoked** state. Morgan's used pass cannot be revoked.

## 2:15–3:00 Show the technical evidence

Open **More options → Connection & verification** to explain the local/network boundary. Then use the [reviewer status](reviewer-status.md) links to show:

1. The original Compact contract and its issuer/bearer assertions, full compiler artifacts, 19 generated-runtime tests and six compiler checks
2. Genuine local **issue, redeem and revoke** proofs, each passing the official prover's cryptographic self-verification; the wrong-verifier control rejected. The separate ledger WASM check is structural only
3. The owner's **actual Preview deployment**, independently verified at finalized block **1169309**, and the exact successful [public CI run](https://github.com/Lpd22664/guestlist-midnight-event-pass/actions/runs/37451385375)

Close with the remaining boundary: network issue/redeem/revoke, concurrency/recovery acceptance and live gate admission are pending. The displayed synthetic admission is not their evidence. No anonymity guarantee, independent security audit or production suitability is claimed.

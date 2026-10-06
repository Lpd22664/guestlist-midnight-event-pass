import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUnprovenDeployTx, createUnprovenCallTxFromInitialStates } from '@midnight-ntwrk/midnight-js-contracts';
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { ChargedState } from '@midnight-ntwrk/midnight-js-protocol/onchain-runtime';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { compiledEventPass, BrowserZkConfigProvider, derivePassCommitment, deriveIssuerCommitment, assertTransactionAttribution, verifyReceipt } from '../dist/index.js';

test('actual SDK-created deploy/issue/redeem/revoke transactions satisfy exact public attribution', async () => {
  // Actual local SDK execution/transaction construction only. Finalization metadata is synthetic.
  setNetworkId('preview'); const base = 'https://synthetic.local/midnight/event-pass/';
  const zkConfigProvider = new BrowserZkConfigProvider(base, async url => new Response(await readFile(new URL('../public/midnight/event-pass/' + new URL(url).pathname.replace('/midnight/event-pass/', ''), import.meta.url))));
  const eventId = new Uint8Array(32).fill(1), issuerSecret = new Uint8Array(32).fill(2), bearerSecret = new Uint8Array(32).fill(3);
  const compiledContract = compiledEventPass(base), coinPublicKey = '01'.repeat(32), walletEncryptionPublicKey = '02'.repeat(32);
  const deployed = await createUnprovenDeployTx({ zkConfigProvider, walletProvider: { getCoinPublicKey: () => coinPublicKey, getEncryptionPublicKey: () => walletEncryptionPublicKey } }, { compiledContract, initialPrivateState: { issuerSecret }, args: [eventId, issuerSecret], signingKey: '11'.repeat(32) });
  const contractAddress = deployed.public.contractAddress, commitment = derivePassCommitment(eventId, bearerSecret), issuerCommitment = deriveIssuerCommitment(eventId, issuerSecret);
  const call = (circuitId, initialContractState, initialPrivateState) => createUnprovenCallTxFromInitialStates(zkConfigProvider, { compiledContract, circuitId, contractAddress, args: [commitment], coinPublicKey, initialContractState, initialZswapChainState: new ZswapChainState(), ledgerParameters: LedgerParameters.initialParameters(), initialPrivateState }, walletEncryptionPublicKey);
  const issue = await call('issue', deployed.public.initialContractState, { issuerSecret });
  const active = ContractState.deserialize(deployed.public.initialContractState.serialize()); active.data = new ChargedState(issue.public.nextContractState);
  const redeem = await call('redeem', active, { bearerSecret }), revoke = await call('revoke', active, { issuerSecret });
  const stateAfter = value => { const state = ContractState.deserialize(active.serialize()); state.data = new ChargedState(value.public.nextContractState); return state; };
  for (const [action, result, state] of [['deploy', deployed, deployed.public.initialContractState], ['issue', issue, active], ['redeem', redeem, stateAfter(redeem)], ['revoke', revoke, stateAfter(revoke)]]) {
    const tx = result.private.unprovenTx, identifiers = tx.identifiers(); assert.ok(identifiers[0]);
    const data = { tx, identifiers, txId: identifiers[0], txHash: 'synthetic-offline-hash', status: 'SucceedEntirely', segmentStatusMap: new Map([...tx.intents.keys()].map(segment => [segment, 'SegmentSuccess'])), blockHash: 'synthetic-offline-block', blockHeight: 42, blockTimestamp: 1_700_000_000 };
    const intent = { network: 'preview', action, contractAddress, eventId, issuerCommitment, ...(action !== 'deploy' ? { commitment } : {}) };
    assert.doesNotThrow(() => assertTransactionAttribution(data, intent));
    let pinned;
    const receipt = await verifyReceipt({ queryContractState: async (_, config) => { pinned = config; return state; } }, data, intent);
    assert.equal(receipt.action, action); assert.deepEqual(pinned, { type: 'blockHash', blockHash: data.blockHash });
    assert.ok(!JSON.stringify(receipt).includes('issuerSecret'));
    if (action !== 'deploy') assert.throws(() => assertTransactionAttribution(data, { ...intent, commitment: new Uint8Array(32).fill(8) }), /expected contract/);
    else assert.throws(() => assertTransactionAttribution(data, { ...intent, eventId: new Uint8Array(32).fill(8) }), /expected contract/);
  }
});

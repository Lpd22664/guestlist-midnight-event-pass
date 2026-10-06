import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import { createBrowserSession, openOwnerStorage, ownerCreateMaintenanceSigningKey } from '../dist/index.js';

// Explicitly synthetic API-4/storage fixtures. No real wallet, private owner key, prover call or network operation.
const scope={network:'preview',ownerAccountId:'synthetic-session-owner',eventId:'01'.repeat(32),role:'issuer'};
const cpk=ShieldedCoinPublicKey.codec.encode('preview',ShieldedCoinPublicKey.fromHexString('02'.repeat(32))).asString();
const epk=ShieldedEncryptionPublicKey.codec.encode('preview',ShieldedEncryptionPublicKey.fromHexString('03'.repeat(32))).asString();
async function fixture() {
 globalThis.indexedDB=new IDBFactory();
 const key=await webcrypto.subtle.importKey('raw',new Uint8Array(32).fill(7),'AES-GCM',false,['encrypt','decrypt']);
 const config={networkId:'preview',indexerUri:'https://synthetic.local/graphql',indexerWsUri:'wss://synthetic.local/graphql',substrateNodeUri:'wss://synthetic.local/node'};
 let changed=false,disconnected=false,reads=0;
 const wallet={getConfiguration:async()=>config,getConnectionStatus:async()=>{reads++;return disconnected?{status:'disconnected'}:{status:'connected',networkId:'preview'}},getShieldedAddresses:async()=>({shieldedCoinPublicKey:changed?epk:cpk,shieldedEncryptionPublicKey:epk}),getProvingProvider:async()=>({check:async()=>{throw Error('No proving in this fixture')},prove:async()=>{throw Error('No proving in this fixture')}})};
 const session=await createBrowserSession({scope,initialApi:{name:'synthetic API4 wallet',rdns:'test.synthetic',apiVersion:'4.0.1',connect:async()=>wallet},compiledAssetsBaseUrl:'https://synthetic.local/midnight/event-pass/',encryptionKey:key,proofDestination:'synthetic-owner-local-prover',authorizeStorage:async()=>true,authorizeConnection:async()=>true,authorizeWalletProver:async()=>true,authorizeOperation:async()=>false});
 return{session,key,config,changeAccount:()=>{changed=true},disconnect:()=>{disconnected=true},reads:()=>reads};
}
test('browser session reads public durable attempts without exposing private storage',async()=>{
 const f=await fixture();assert.equal(await f.session.readAttempt('synthetic-empty'),null);
 const storage=await openOwnerStorage({scope,encryptionKey:f.key,authorize:async()=>true});
 const attempt={requestId:'synthetic-public-attempt',network:'preview',action:'deploy',eventId:scope.eventId,issuerCommitment:'04'.repeat(32),state:'unknown',expiresAt:Date.now()+10000};
 await storage.journal.create({ ...attempt, state: 'started' }); await storage.journal.update(attempt);assert.deepEqual(await f.session.readAttempt(attempt.requestId),attempt);assert.equal('privateStateProvider' in f.session,false);storage.close();f.session.close();await assert.rejects(f.session.readAttempt(attempt.requestId),/closed/);
});
test('browser session account guard closes session and prevents further wallet checks',async()=>{
 const f=await fixture();await f.session.checkConnection();f.changeAccount();await assert.rejects(f.session.checkConnection(),/disconnected or account/);const reads=f.reads();await assert.rejects(f.session.checkConnection(),/closed/);assert.equal(f.reads(),reads);
});
test('browser session snapshots wallet configuration so in-place service changes lock it',async()=>{
 const f=await fixture();const original=f.session.configuration.indexerUri;f.config.indexerUri='https://changed.synthetic.local/graphql';assert.equal(f.session.configuration.indexerUri,original);await assert.rejects(f.session.checkConnection(),/services changed/);
});
test('official maintenance generator rejects missing owner final action or bearer role before generation',()=>{
 assert.throws(()=>ownerCreateMaintenanceSigningKey({ownerConfirmedFinalAction:false,role:'issuer'}),/final action/);
 assert.throws(()=>ownerCreateMaintenanceSigningKey({ownerConfirmedFinalAction:true,role:'bearer'}),/final action/);
 // No accepted-generation path is executed by the assistant or this offline QA.
});

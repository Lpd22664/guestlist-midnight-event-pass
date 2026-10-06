import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { CONSENT_REQUIREMENTS, ConsentQueue } from '../src/live/consent';
import { createRecoveryFile, importOwnerFile } from '../src/live/custody';
import { PublicHistory } from '../src/live/public-history';
import { sharedHistoryLock } from './live-history-lock-fixture';
import { gateContextCopy, isUnresolved, loadPublicAttempts, publicAttemptCopy, publicHex32, receiptIsFinal, trustedEvent, type PublicAttempt, type PublicReceipt } from '../src/live/model';
const eventId = '11'.repeat(32), capability = '22'.repeat(32), vault = '33'.repeat(32), contract = '44'.repeat(32), issuer = '55'.repeat(32);
const cryptoImpl = webcrypto as unknown as Crypto;
const store = () => { const data = new Map<string,string>(); return { data, getItem: (key:string)=>data.get(key)??null, setItem: (key:string,value:string)=>{data.set(key,value)} }; };
function receipt(action:PublicAttempt['action']='issue'):PublicReceipt{return {schema:'midnight-event-pass-receipt-v1',network:'preview',action,contractAddress:contract,txId:'aa'.repeat(33),identifiers:['aa'.repeat(33)],txHash:'bb'.repeat(32),blockHash:'cc'.repeat(32),blockHeight:12,blockTimestamp:1,transactionStatus:'SucceedEntirely',stateCheck:'verified-at-finalized-block',eventId,commitment:capability,publicState:{eventId,issuerCommitment:issuer,issuedCount:'1',redeemedCount:'0',revokedCount:'0',passStatus:'ACTIVE'}};}
const attempt:PublicAttempt={requestId:'request-1',action:'issue',ownerAccountId:'owner-1',eventId,role:'issuer',status:'pending',commitment:capability};

test('Preview event identity rejects demo/mainnet credentials and missing public trust anchors',()=>{
 assert.throws(()=>trustedEvent({network:'mainnet',contractAddress:contract,eventId,issuerCommitment:issuer}));
 assert.throws(()=>trustedEvent('guestlist-demo:secret'));
 assert.throws(()=>trustedEvent({network:'preview',contractAddress:contract,eventId}));
 assert.deepEqual(trustedEvent({network:'preview',contractAddress:contract,eventId,issuerCommitment:issuer,bearerSecret:capability}),{network:'preview',contractAddress:contract,eventId,issuerCommitment:issuer,trust:'owner-reviewed'});
 assert.throws(()=>publicHex32('00'.repeat(32)));
});
test('public attempt persistence strips private extras and preserves request/real transaction identity',async()=>{
 const storage=store(), final={...attempt,status:'verified' as const,receipt:receipt(),bearerSecret:capability,issuerSecret:capability};
 await new PublicHistory(storage,sharedHistoryLock()).merge([final]);const encoded=[...storage.data.values()][0];
 assert.equal(encoded.includes('bearerSecret'),false);assert.equal(encoded.includes('issuerSecret'),false);
 const decoded=loadPublicAttempts(storage);assert.equal(decoded[0].requestId,'request-1');assert.equal(decoded[0].receipt?.txId.length,66);assert.equal(decoded[0].receipt?.txId===decoded[0].requestId,false);
});
test('live success requires complete finalized attributed receipt and matching scope',()=>{
 assert.equal(receiptIsFinal(receipt(),attempt,trustedEvent({network:'preview',contractAddress:contract,eventId,issuerCommitment:issuer})),true);
 assert.equal(receiptIsFinal({...receipt(),stateCheck:'unverified' as never},attempt),false);
 assert.equal(receiptIsFinal({...receipt(),eventId:'77'.repeat(32)},attempt),false);
 assert.throws(()=>publicAttemptCopy({...attempt,status:'verified'}));
 assert.equal(isUnresolved(attempt),true);assert.equal(isUnresolved({...attempt,status:'unknown'}),true);assert.equal(isUnresolved({...attempt,status:'rejected'}),false);
});
test('corrupt public request history fails closed instead of resetting',()=>{
 const storage=store();storage.setItem('guestlist.midnight-preview.public.v1','{bad');assert.throws(()=>loadPublicAttempts(storage));
});
test('gate public context strips authority/capabilities and keeps unknown request identity',()=>{
 const copy=gateContextCopy({network:'preview',contractAddress:contract,eventId,issuerCommitment:issuer,commitment:capability,requestId:'gate-1',status:'unknown',txId:'aa'.repeat(33),apiSecret:'secret',bearerSecret:'secret'});
 assert.equal('apiSecret' in copy,false);assert.equal('bearerSecret' in copy,false);assert.equal(copy.requestId,'gate-1');assert.equal(copy.status,'unknown');
});
test('all owner custody steps have explicit non-agent final action requirements',()=>{
 assert.equal(CONSENT_REQUIREMENTS.provision.mode,'per-action');assert.equal(CONSENT_REQUIREMENTS.provision.agentMayExecute,false);
 assert.equal(CONSENT_REQUIREMENTS.importPrivateFile.mode,'hand-off');assert.equal(CONSENT_REQUIREMENTS.gateAuthority.mode,'hand-off');
 for(const rule of Object.values(CONSENT_REQUIREMENTS))assert.equal(rule.ownerFinalAction,true);
});
test('consent stays pending until exact owner response; decline and cancellation are false',async()=>{
 const queue=new ConsentQueue();let settled=false;const request={requirement:'connection' as const,title:'connect',details:['Preview only'],acceptLabel:'connect'};
 const promise=queue.request(request).then(value=>{settled=true;return value});await Promise.resolve();assert.equal(settled,false);assert.equal(queue.getSnapshot(),request);
 await assert.rejects(queue.request(request));queue.respond(false);assert.equal(await promise,false);assert.equal(queue.getSnapshot(),undefined);
 const accepted=queue.request(request);queue.respond(true);assert.equal(await accepted,true);
});
test('owner-selected issuer fixture imports nonextractable AES and excludes bearer custody',async()=>{
 const file={schema:'guestlist-owner-custody-v1',network:'preview',role:'issuer',ownerAccountId:'owner-1',eventId,vaultKeyHex:vault,issuerSecretHex:capability,maintenanceSigningKey:'66'.repeat(32)};
 const custody=await importOwnerFile(JSON.stringify(file),{role:'issuer',ownerAccountId:'owner-1',eventId},cryptoImpl);
 assert.equal(custody.encryptionKey.extractable,false);assert.equal(custody.encryptionKey.algorithm.name,'AES-GCM');assert.equal(custody.capability.length,32);assert.equal(custody.role,'issuer');
 await assert.rejects(importOwnerFile(JSON.stringify({...file,bearerSecretHex:capability}),{role:'issuer',ownerAccountId:'owner-1',eventId},cryptoImpl));
 await assert.rejects(importOwnerFile(JSON.stringify(file),{role:'bearer',ownerAccountId:'owner-1',eventId},cryptoImpl));custody.capability.fill(0);
});
test('owner bearer fixture cannot contain issuer or maintenance authority',async()=>{
 const file={schema:'guestlist-owner-custody-v1',network:'preview',role:'bearer',ownerAccountId:'bearer-1',eventId,vaultKeyHex:vault,bearerSecretHex:capability};
 const scope={role:'bearer' as const,ownerAccountId:'bearer-1',eventId};const c=await importOwnerFile(JSON.stringify(file),scope,cryptoImpl);assert.equal(c.maintenanceSigningKey,undefined);
 await assert.rejects(importOwnerFile(JSON.stringify({...file,maintenanceSigningKey:'66'.repeat(32)}),scope,cryptoImpl));
 await assert.rejects(importOwnerFile(JSON.stringify({...file,issuerSecretHex:capability}),scope,cryptoImpl));c.capability.fill(0);
});
test('provisioning synthetic fixture requires final owner action and never implicitly creates maintenance key',async()=>{
 let keyCalls=0;let calls=0;
 // Deterministic synthetic randomness: no real wallet, maintenance grant, or network action.
 const fake={getRandomValues:(array:Uint8Array)=>{array.fill(++calls);return array;}} as unknown as Crypto;
 const options={role:'bearer' as const,eventId,ownerAccountId:'bearer-1',includeMaintenance:false,ownerConfirmedFinalAction:true as const,createMaintenanceKey:()=>{keyCalls++;return '66'.repeat(32)}};
 const file=await createRecoveryFile(options,fake);assert.equal(file.vaultKeyHex,'01'.repeat(32));assert.equal(file.bearerSecretHex,'02'.repeat(32));assert.equal(file.issuerSecretHex,undefined);assert.equal(keyCalls,0);
 await assert.rejects(createRecoveryFile({...options,ownerConfirmedFinalAction:false as never},fake));
 await assert.rejects(createRecoveryFile({...options,includeMaintenance:true},fake));
});
test('persisted deployment registry carries only public finalized evidence and stays separate from custody',async()=>{
 const {eventRegistryCopy}=await import('../src/live/model');
 const deploy={...receipt('deploy'),commitment:undefined};
 const input={network:'preview',contractAddress:contract,eventId,issuerCommitment:issuer,trust:'finalized-deployment',deploymentReceipt:deploy,issuerSecret:'secret'};
 const copy=eventRegistryCopy(input);assert.equal(copy.trust,'finalized-deployment');assert.equal(copy.deploymentReceipt?.txId.length,66);assert.equal('issuerSecret' in copy,false);
 assert.throws(()=>eventRegistryCopy({...input,deploymentReceipt:undefined}));assert.throws(()=>eventRegistryCopy({...input,eventId:'77'.repeat(32)}));
});

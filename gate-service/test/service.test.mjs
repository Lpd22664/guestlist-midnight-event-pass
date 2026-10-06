import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { GateError, GateAuth, GateService, GateStore } from '../dist/service.js';
import { createAdmissionClient } from '../dist/client.js';
import { fixture, deferred, REQUEST, EVENT, RECEIPT, TX, ALIAS, HEAD, AUTH_A, AUTH_B, KEY_A } from './fixtures.mjs';
const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof GateError && error.code === code);
const open = f => f.service.openRedemption('north', AUTH_A, REQUEST);
const claim = (f, txId = TX) => f.service.claimRedemption('north', AUTH_A, { requestId: REQUEST.requestId, txId });

test('requires durable absolute database and explicit existing authority; no default key', () => {
  assert.throws(() => new GateStore(':memory:'), /durable/);
  assert.throws(() => new GateStore('./gate.sqlite'), /durable/);
  assert.throws(() => new GateAuth({}), /Explicit/);
  assert.throws(() => new GateAuth({ north: 'short' }), /Invalid/);
  assert.throws(() => createAdmissionClient({ serviceUrl: 'http://gate.example', gateId:'north', apiSecret: KEY_A }), /HTTPS/);
});
test('unauthorized and unconfigured clients do not read chain or reserve', async t => {
  const f=fixture(); t.after(f.close);
  await rejectsCode(f.service.openRedemption('north', 'Bearer wrong', REQUEST), 'unauthorized');
  await rejectsCode(f.service.openRedemption('north', AUTH_A, { ...REQUEST, eventId: '55'.repeat(32) }), 'event-not-configured');
  assert.deepEqual(f.calls,{ baseline:0,receipt:0 }); assert.equal(f.store.get(REQUEST.requestId,'north'),undefined);
});
test('schema rejects secret, name, email, client receipt and uppercase/unbounded inputs', async t => {
  const f=fixture(); t.after(f.close);
  for (const extra of ['bearerSecret','issuerSecret','name','email','receipt']) await rejectsCode(f.service.openRedemption('north',AUTH_A,{...REQUEST,[extra]:'must-never-persist'}),'invalid-request');
  await rejectsCode(f.service.openRedemption('north',AUTH_A,{...REQUEST,commitment:'AA'.repeat(32)}),'invalid-request');
  await rejectsCode(f.service.openRedemption('north',AUTH_A,{...REQUEST,requestId:'x'.repeat(100)}),'invalid-request');
  assert.equal(f.calls.baseline,0);
});
test('USED/revoked/absent baseline fails closed; receipt cannot create an attempt', async t => {
  const f=fixture({reader:{readActiveBaseline:async()=>{throw new GateError('not-active',409);},verifyRedemption:async()=>RECEIPT}});t.after(f.close);
  await rejectsCode(open(f),'not-active'); await rejectsCode(claim(f),'attempt-not-found');
});
test('independent baseline errors and late timeout never reserve', async t => {
  const delay=deferred();const f=fixture({reader:{readActiveBaseline:()=>delay.promise,verifyRedemption:async()=>RECEIPT},serviceOptions:{verificationTimeoutMs:10}});t.after(f.close);
  await rejectsCode(open(f),'verification-timeout');delay.resolve({hash:HEAD,height:10});await new Promise(r=>setTimeout(r,20));
  assert.equal(f.store.get(REQUEST.requestId,'north'),undefined);
});
test('open retry preserves baseline and public gate context without another chain read', async t => {
  const f=fixture();t.after(f.close); const first=await open(f),retry=await open(f);
  assert.equal(first.admit,false); assert.deepEqual(first,retry);assert.equal(f.calls.baseline,1);
  assert.equal(f.service.readRedemption('north',AUTH_A,{requestId:REQUEST.requestId}).code,'pending');
  assert.throws(()=>f.service.readRedemption('south',AUTH_B,{requestId:REQUEST.requestId}),error=>error.code==='attempt-not-found');
});
test('independent concurrent scanners cannot open two live attempts for same commitment', async t => {
  const f=fixture();t.after(f.close);
  const results=await Promise.allSettled([open(f),f.service.openRedemption('south',AUTH_B,{...REQUEST,requestId:'synthetic-request-0002'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'attempt-conflict');
});
test('same request ID cannot change event/commitment or gate owner', async t => {
  const f=fixture();t.after(f.close);await open(f);
  await rejectsCode(f.service.openRedemption('north',AUTH_A,{...REQUEST,commitment:'55'.repeat(32)}),'attempt-conflict');
  await rejectsCode(f.service.openRedemption('south',AUTH_B,REQUEST),'attempt-conflict');
});
test('expired unbound attempt denies binding and can reserve new ID; unknown bound attempt never resets', async t => {
  let now=1000;const delay=deferred();const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>delay.promise},serviceOptions:{now:()=>now,attemptLifetimeMs:100,verificationTimeoutMs:10}});t.after(f.close);
  await open(f);now=1101;await rejectsCode(claim(f),'attempt-expired');
  const next={...REQUEST,requestId:'synthetic-request-0002'};await f.service.openRedemption('north',AUTH_A,next);
  await rejectsCode(f.service.claimRedemption('north',AUTH_A,{requestId:next.requestId,txId:TX}),'verification-timeout');now=999999;
  await rejectsCode(f.service.openRedemption('south',AUTH_B,{...REQUEST,requestId:'synthetic-request-0003'}),'attempt-conflict');
  delay.reject(new Error('fixture-finished'));
});
test('successful verified receipt commits once; concurrent/replay responses never re-admit', async t => {
  const f=fixture();t.after(f.close);await open(f);
  const results=await Promise.all(Array.from({length:12},()=>claim(f)));
  assert.equal(results.filter(r=>r.admit).length,1);assert.equal(f.calls.receipt,1);
  assert.equal((await claim(f)).code,'already-claimed');assert.equal(f.calls.receipt,1);
  const recovery=f.service.readRedemption('north',AUTH_A,{requestId:REQUEST.requestId});assert.equal(recovery.admit,false);assert.equal(recovery.code,'claimed');
});
test('one candidate is permanently bound; mismatch and reopen never resubmit', async t => {
  const delay=deferred();const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>delay.promise},serviceOptions:{verificationTimeoutMs:10}});t.after(f.close);
  await open(f);await rejectsCode(claim(f),'verification-timeout');await rejectsCode(claim(f,ALIAS),'transaction-conflict');await rejectsCode(open(f),'transaction-conflict');
  assert.equal(f.store.get(REQUEST.requestId,'north').txId,TX);delay.reject(new Error('fixture-finished'));
});
test('timeouts share bounded outstanding read; late resolution never autonomously admits; retry reconciles', async t => {
  const delay=deferred();let reads=0;const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>{reads++;return delay.promise;}},serviceOptions:{verificationTimeoutMs:10}});t.after(f.close);
  await open(f);await rejectsCode(claim(f),'verification-timeout');await rejectsCode(claim(f),'verification-timeout');assert.equal(reads,1);
  delay.resolve(structuredClone(RECEIPT));await new Promise(r=>setTimeout(r,20));assert.equal(f.store.claimed(REQUEST.requestId,'north'),undefined);
  assert.equal((await claim(f)).admit,true);assert.equal((await claim(f)).admit,false);
});
test('bounded verification capacity fails closed while unknown candidate remains recoverable', async t => {
  const delay=deferred();const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>delay.promise},serviceOptions:{verificationTimeoutMs:10,maxConcurrentVerifications:1}});t.after(f.close);
  await open(f);const next={...REQUEST,requestId:'synthetic-request-0002',commitment:'55'.repeat(32)};await f.service.openRedemption('north',AUTH_A,next);await rejectsCode(claim(f),'verification-timeout');
  await rejectsCode(f.service.claimRedemption('north',AUTH_A,{requestId:next.requestId,txId:ALIAS}),'verification-capacity');delay.reject(new Error('fixture-finished'));
});
test('wrong status/state/event/issuer/commitment/prebaseline receipt cannot claim', async t => {
  const invalid=[{...RECEIPT,transactionStatus:'FailFallible'},{...RECEIPT,action:'issue'},{...RECEIPT,eventId:'55'.repeat(32)},{...RECEIPT,commitment:'55'.repeat(32)},{...RECEIPT,blockHeight:10},{...RECEIPT,publicState:{...RECEIPT.publicState,passStatus:'ACTIVE'}},{...RECEIPT,publicState:{...RECEIPT.publicState,issuerCommitment:'55'.repeat(32)}}];
  for(const receipt of invalid){const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:async()=>receipt}});t.after(f.close);await open(f);await rejectsCode(claim(f),'verification-failed');assert.equal(f.store.claimed(REQUEST.requestId,'north'),undefined);}
});
test('public-only whitelist excludes raw provider/private extras from disk and recovery', async t => {
  const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:async()=>({...RECEIPT,bearerSecret:'private-extra-must-not-copy',tx:{secret:'raw-sdk-private-extra'}})}});t.after(f.close);
  await open(f);const result=await claim(f);assert.ok(!JSON.stringify(result).includes('private-extra'));
  const db=new DatabaseSync(f.dbPath);const rows=db.prepare('SELECT public_json FROM gate_attempts').all().concat(db.prepare('SELECT receipt_json FROM gate_claims').all());db.close();assert.ok(!JSON.stringify(rows).includes('private-extra'));assert.ok(!readFileSync(f.dbPath).includes(Buffer.from(KEY_A)));
});
test('restart persists bound unknown candidate and committed claim; lost response is never a second grant', async t => {
  const f=fixture();t.after(f.close);await open(f);await claim(f);f.service.stop();f.store.close();
  const store=new GateStore(f.dbPath);const service=new GateService({store,auth:f.auth,events:[{event:EVENT,reader:f.reader}]});t.after(()=>{service.stop();store.close();});
  assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:REQUEST.requestId,txId:TX})).admit,false);
  assert.equal(service.readRedemption('north',AUTH_A,{requestId:REQUEST.requestId}).code,'claimed');
});
test('storage failure after verification and service stop both fail closed', async t => {
  const delay=deferred();const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>delay.promise}});t.after(f.close);await open(f);const pending=claim(f);
  await new Promise(r=>setTimeout(r,0));f.store.close();delay.resolve(RECEIPT);await rejectsCode(pending,'storage-unavailable');
  const g=fixture();t.after(g.close);g.service.stop();await rejectsCode(open(g),'service-unavailable');
});
test('durable capacity exhausts safely; no destructive cleanup erases claims', async t => {
  const f=fixture({storeOptions:{maxAttempts:1}});t.after(f.close);await open(f);await claim(f);
  await rejectsCode(f.service.openRedemption('north',AUTH_A,{...REQUEST,requestId:'synthetic-request-0002',commitment:'55'.repeat(32)}),'storage-unavailable');assert.equal((await claim(f)).admit,false);
});
test('process-isolated concurrent claim grants only once across shared SQLite file', async t => {
  const f=fixture();t.after(f.close);await open(f);
  const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[new URL('./claim-process.mjs',import.meta.url).pathname,f.dbPath],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.once('error',reject);child.once('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));});
  const results=await Promise.all(Array.from({length:4},run));assert.equal(results.filter(r=>r.admit).length,1);assert.equal((await claim(f)).admit,false);
});
test('browser client sends public allowlist only and close revokes new use', async () => {
  let body,headers;const client=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async(_url,init)=>{body=init.body;headers=init.headers;return new Response(JSON.stringify({admit:false,code:'opened',attempt:{...REQUEST,gateId:'north',openedAt:1,expiresAt:101,baselineBlockHash:HEAD,baselineBlockHeight:10,status:'open'}}),{status:200,headers:{'Content-Type':'application/json'}});}});
  await client.openRedemption({...REQUEST,bearerSecret:'must-not-transmit'});assert.ok(!body.includes('bearerSecret'));assert.equal(headers.Authorization,AUTH_A);client.close();await rejectsCode(client.health(),'service-unavailable');
});
test('timed-out baseline reads share bounded pending work and never become late reservations',async t=>{
  const delay=deferred();let reads=0;const f=fixture({reader:{readActiveBaseline:()=>{reads++;return delay.promise;},verifyRedemption:async()=>RECEIPT},serviceOptions:{verificationTimeoutMs:10,maxConcurrentVerifications:1}});t.after(f.close);
  await rejectsCode(open(f),'verification-timeout');await rejectsCode(open(f),'verification-timeout');assert.equal(reads,1);
  await rejectsCode(f.service.openRedemption('north',AUTH_A,{...REQUEST,requestId:'synthetic-other-read-0001'}),'verification-capacity');
  delay.resolve({hash:HEAD,height:10});await new Promise(r=>setTimeout(r,20));assert.equal(f.store.get(REQUEST.requestId,'north'),undefined);
});
test('real SQLite write lock contention fails closed without issuing an admission',async t=>{
  const f=fixture({storeOptions:{busyTimeoutMs:20}});t.after(f.close);await open(f);
  const lock=new DatabaseSync(f.dbPath);lock.exec('BEGIN IMMEDIATE');
  try{await rejectsCode(claim(f),'storage-unavailable');}finally{lock.exec('ROLLBACK');lock.close();}
  assert.equal(f.store.claimed(REQUEST.requestId,'north'),undefined);assert.equal((await claim(f)).admit,true);
});
test('restart recovers the same durable unknown candidate without creating a new attempt',async t=>{
  const delay=deferred();const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>delay.promise},serviceOptions:{verificationTimeoutMs:10}});t.after(f.close);
  await open(f);await rejectsCode(claim(f),'verification-timeout');f.service.stop();f.store.close();
  const store=new GateStore(f.dbPath),service=new GateService({store,auth:f.auth,events:[{event:EVENT,reader:{readActiveBaseline:async()=>{throw new Error('must-not-reopen');},verifyRedemption:async()=>RECEIPT}}]});t.after(()=>{service.stop();store.close();});
  assert.equal(service.readRedemption('north',AUTH_A,{requestId:REQUEST.requestId}).attempt.txId,TX);
  assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:REQUEST.requestId,txId:TX})).admit,true);
  assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:REQUEST.requestId,txId:TX})).admit,false);delay.resolve(RECEIPT);
});
test('stop during an outstanding verifier revokes late commit and admission',async t=>{
  const delay=deferred();const f=fixture({reader:{readActiveBaseline:async()=>({hash:HEAD,height:10}),verifyRedemption:()=>delay.promise}});t.after(f.close);await open(f);
  const pending=claim(f);await new Promise(r=>setTimeout(r,0));f.service.stop();delay.resolve(RECEIPT);await rejectsCode(pending,'service-unavailable');assert.equal(f.store.claimed(REQUEST.requestId,'north'),undefined);
});

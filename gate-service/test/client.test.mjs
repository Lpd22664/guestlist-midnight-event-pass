import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionClient, GateError } from '../dist/client.js';
import { REQUEST, EVENT, RECEIPT, TX, ALIAS, HEAD, KEY_A } from './fixtures.mjs';
const HEALTH = {schema:'guestlist-gate-health-v1',policy:'active-before-redemption-v1',storage:'durable-shared',events:[EVENT]};
const ATTEMPT = {...REQUEST,gateId:'north',openedAt:1,expiresAt:1001,baselineBlockHash:HEAD,baselineBlockHeight:10,status:'open'};
const OPEN = {admit:false,code:'opened',attempt:ATTEMPT};
const {issuerCommitment: _publicTopLevelNotInSchema,...WIRE_RECEIPT} = RECEIPT;
const CLAIM = {admit:true,code:'admitted',requestId:REQUEST.requestId,receipt:WIRE_RECEIPT};
const READ = {admit:false,code:'pending',attempt:ATTEMPT};
const response = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
const clientFor = (value,status=200) => createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>response(value,status)});
const deny = promise => assert.rejects(promise,error=>error instanceof GateError && error.code==='service-unavailable' && error.message==='service-unavailable');
const claim = client => client.claimRedemption({requestId:REQUEST.requestId,txId:TX});

test('browser validates exact healthy policy/storage/event registry and rejects extras/identity errors',async()=>{
  assert.deepEqual(await clientFor(HEALTH).health(),HEALTH);
  for(const value of [{...HEALTH,policy:'permit-used'},{...HEALTH,storage:'local-only'},{...HEALTH,events:[]},{...HEALTH,events:[{...EVENT,eventId:'invalid'}]},{...HEALTH,events:[EVENT,EVENT]},{...HEALTH,events:[{...EVENT,bearerSecret:'private-fragment'}]},{...HEALTH,apiSecret:'private-fragment'}]) await deny(clientFor(value).health());
});
test('open response must exactly deny admission and match all public request/gate fields',async()=>{
  assert.deepEqual(await clientFor(OPEN).openRedemption(REQUEST),OPEN);
  for(const value of [{...OPEN,admit:'false'},{...OPEN,admit:true},{...OPEN,code:'admitted'},{...OPEN,attempt:{...ATTEMPT,requestId:'wrong-request-0001'}},{...OPEN,attempt:{...ATTEMPT,commitment:'55'.repeat(32)}},{...OPEN,attempt:{...ATTEMPT,gateId:'south'}},{...OPEN,attempt:{...ATTEMPT,status:'bound',txId:TX}},{...OPEN,attempt:{...ATTEMPT,openedAt:1001,expiresAt:1}},{...OPEN,attempt:{...ATTEMPT,name:'private-fragment'}}]) await deny(clientFor(value).openRedemption(REQUEST));
});
test('claim requires exact boolean/discriminator/request and rejects truthy false or contradictory grant',async()=>{
  assert.equal((await claim(clientFor(CLAIM))).admit,true);
  assert.equal((await claim(clientFor({...CLAIM,admit:false,code:'already-claimed'}))).admit,false);
  for(const value of [{...CLAIM,admit:'false'},{...CLAIM,admit:'true'},{...CLAIM,admit:1},{...CLAIM,admit:null},{...CLAIM,admit:true,code:'already-claimed'},{...CLAIM,admit:false,code:'admitted'},{...CLAIM,requestId:'wrong-request-0001'},{...CLAIM,code:'private-fragment'},{...CLAIM,debug:'private-fragment'}]) await deny(claim(clientFor(value)));
});
test('claim validates complete receipt/state public schema, identifiers and immutable opened identity',async()=>{
  for(const receipt of [{...WIRE_RECEIPT,schema:'raw-receipt'},{...WIRE_RECEIPT,action:'issue'},{...WIRE_RECEIPT,transactionStatus:'FailEntirely'},{...WIRE_RECEIPT,stateCheck:'client-success'},{...WIRE_RECEIPT,txId:ALIAS},{...WIRE_RECEIPT,identifiers:[ALIAS]},{...WIRE_RECEIPT,identifiers:[TX,TX]},{...WIRE_RECEIPT,txHash:'invalid'},{...WIRE_RECEIPT,blockHeight:-1},{...WIRE_RECEIPT,publicState:{...WIRE_RECEIPT.publicState,passStatus:'ACTIVE'}},{...WIRE_RECEIPT,publicState:{...WIRE_RECEIPT.publicState,eventId:'55'.repeat(32)}},{...WIRE_RECEIPT,publicState:{...WIRE_RECEIPT.publicState,redeemedCount:'-1'}},{...WIRE_RECEIPT,bearerSecret:'private-fragment'}]) await deny(claim(clientFor({...CLAIM,receipt})));
  const queue=[OPEN,{...CLAIM,receipt:{...WIRE_RECEIPT,commitment:'55'.repeat(32)}}];const client=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>response(queue.shift())});
  const opened=await client.openRedemption(REQUEST);opened.attempt.commitment='55'.repeat(32);await deny(claim(client));
});
test('canonical/submitted aliases and genuine 66-character IDs remain compatible after wire validation',async()=>{
  const taggedCanonical='00'+TX,taggedAlias='01'+ALIAS;
  const receipt={...WIRE_RECEIPT,txId:taggedCanonical,identifiers:[taggedCanonical,taggedAlias]};
  const result=await clientFor({...CLAIM,receipt}).claimRedemption({requestId:REQUEST.requestId,txId:taggedAlias});assert.equal(result.admit,true);assert.equal(result.receipt.txId,taggedCanonical);
  await deny(clientFor({...CLAIM,receipt:{...receipt,identifiers:[taggedCanonical]}}).claimRedemption({requestId:REQUEST.requestId,txId:taggedAlias}));
});
test('read is always admit false and enforces status/receipt discriminator and gate ownership',async()=>{
  assert.deepEqual(await clientFor(READ).readRedemption({requestId:REQUEST.requestId}),READ);
  const claimed={admit:false,code:'claimed',attempt:{...ATTEMPT,status:'claimed',txId:TX},receipt:WIRE_RECEIPT};
  assert.equal((await clientFor(claimed).readRedemption({requestId:REQUEST.requestId})).admit,false);
  for(const value of [{...READ,admit:'false'},{...READ,admit:true},{...READ,code:'admitted'},{...READ,code:'claimed'},{...READ,receipt:WIRE_RECEIPT},{...READ,attempt:{...ATTEMPT,status:'claimed',txId:TX}},{...claimed,receipt:{...WIRE_RECEIPT,commitment:'55'.repeat(32)}},{...claimed,attempt:{...ATTEMPT,status:'claimed',txId:ALIAS}}]) await deny(clientFor(value).readRedemption({requestId:REQUEST.requestId}));
});
test('known errors preserve fixed code but unexpected server code/body/JSON fragments are redacted',async()=>{
  await assert.rejects(clientFor({admit:false,code:'unauthorized'},401).health(),error=>error.code==='unauthorized');
  for(const value of [{admit:false,code:'credential-private-fragment'},{admit:'false',code:'unauthorized'},{admit:false,code:'unauthorized',message:'private-fragment'}]) await deny(clientFor(value,401).health());
  const client=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>new Response('private-fragment invalid-json',{status:500,headers:{'Content-Type':'application/json'}})});await deny(client.health());
  const throwing=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>{throw new Error('private-fragment');}});await deny(throwing.health());
});
test('response size is bounded with and without Content-Length and non-JSON MIME is refused',async()=>{
  let canceled=false;const huge=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(128*1024+1));},cancel(){canceled=true;}});
  const streamClient=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>new Response(huge,{headers:{'Content-Type':'application/json'}})});await deny(streamClient.health());assert.equal(canceled,true);
  for(const headers of [{'Content-Length':String(128*1024+1)},{'Content-Type':'text/html'}]){const client=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>response(HEALTH,200,headers)});await deny(client.health());}
});
test('a loaded registry prevents changed event identity; close aborts and refuses late responses',async()=>{
  const queue=[HEALTH,{...CLAIM,receipt:{...WIRE_RECEIPT,contractAddress:'55'.repeat(32)}}];const client=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:async()=>response(queue.shift())});await client.health();await deny(claim(client));
  let resolve;const delayed=createAdmissionClient({serviceUrl:'https://gate.example',gateId:'north',apiSecret:KEY_A,fetchImpl:()=>new Promise(r=>resolve=r)});
  const pending=delayed.health();delayed.close();resolve(response(HEALTH));await deny(pending);await deny(delayed.health());
});

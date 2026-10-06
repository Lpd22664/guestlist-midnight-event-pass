import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createUnprovenDeployTx, createUnprovenCallTxFromInitialStates } from '../../browser-integration/node_modules/@midnight-ntwrk/midnight-js-contracts/dist/index.mjs';
import { LedgerParameters, ZswapChainState } from '../../browser-integration/node_modules/@midnight-ntwrk/midnight-js-protocol/dist/ledger.mjs';
import { ContractState } from '../../browser-integration/node_modules/@midnight-ntwrk/midnight-js-protocol/dist/compact-runtime.mjs';
import { ChargedState } from '../../browser-integration/node_modules/@midnight-ntwrk/midnight-js-protocol/dist/onchain-runtime.mjs';
import { setNetworkId } from '../../browser-integration/node_modules/@midnight-ntwrk/midnight-js-network-id/dist/index.mjs';
import { compiledEventPass, derivePassCommitment, deriveIssuerCommitment } from '../../browser-integration/dist/contract.js';
import { BrowserZkConfigProvider } from '../../browser-integration/dist/zk-assets.js';
import { GateService, GateAuth, GateError } from '../dist/service.js';
import { ReadOnlyNode, createVerifiedChainReader } from '../dist/chain.js';
import { fixture, AUTH_A, KEY_A, HEAD, BLOCK, TX, ALIAS } from './fixtures.mjs';
const hex = value => Buffer.from(value).toString('hex');
const rejects = (value, code) => assert.rejects(value, error=>error.code===code);
async function actualSdkFixture() {
  // Real generated contract + pinned SDK local execution. No proof/signature/submission/live finality.
  setNetworkId('preview');const base='https://synthetic.local/midnight/event-pass/';
  const zkConfigProvider=new BrowserZkConfigProvider(base,async url=>new Response(await readFile(new URL('../../browser-integration/public/midnight/event-pass/'+new URL(url).pathname.replace('/midnight/event-pass/',''),import.meta.url))));
  const eventId=new Uint8Array(32).fill(1),issuerSecret=new Uint8Array(32).fill(2),bearerSecret=new Uint8Array(32).fill(3);
  const compiledContract=compiledEventPass(base),coinPublicKey='01'.repeat(32),walletEncryptionPublicKey='02'.repeat(32);
  const deployed=await createUnprovenDeployTx({zkConfigProvider,walletProvider:{getCoinPublicKey:()=>coinPublicKey,getEncryptionPublicKey:()=>walletEncryptionPublicKey}},{compiledContract,initialPrivateState:{issuerSecret},args:[eventId,issuerSecret],signingKey:'11'.repeat(32)});
  const contractAddress=deployed.public.contractAddress,commitment=derivePassCommitment(eventId,bearerSecret),issuerCommitment=deriveIssuerCommitment(eventId,issuerSecret);
  const call=(circuitId,initialContractState,initialPrivateState)=>createUnprovenCallTxFromInitialStates(zkConfigProvider,{compiledContract,circuitId,contractAddress,args:[commitment],coinPublicKey,initialContractState,initialZswapChainState:new ZswapChainState(),ledgerParameters:LedgerParameters.initialParameters(),initialPrivateState},walletEncryptionPublicKey);
  const issue=await call('issue',deployed.public.initialContractState,{issuerSecret});const active=ContractState.deserialize(deployed.public.initialContractState.serialize());active.data=new ChargedState(issue.public.nextContractState);
  const redeem=await call('redeem',active,{bearerSecret}),revoke=await call('revoke',active,{issuerSecret});
  const used=ContractState.deserialize(active.serialize());used.data=new ChargedState(redeem.public.nextContractState);
  const revoked=ContractState.deserialize(active.serialize());revoked.data=new ChargedState(revoke.public.nextContractState);
  const dataFor=result=>{const tx=result.private.unprovenTx,identifiers=tx.identifiers();return {tx,identifiers,txId:identifiers[0],txHash:'e5'.repeat(32),status:'SucceedEntirely',segmentStatusMap:new Map([...tx.intents.keys()].map(segment=>[segment,'SegmentSuccess'])),blockHash:BLOCK,blockHeight:11,blockTimestamp:1700000000};};
  return {event:{network:'preview',contractAddress,eventId:hex(eventId),issuerCommitment:hex(issuerCommitment)},commitment:hex(commitment),active,used,revoked,redeem:dataFor(redeem),issue:dataFor(issue),revoke:dataFor(revoke)};
}
let sdkPromise; const sdk=()=>sdkPromise??=actualSdkFixture();
function providerFor(s, data=s.redeem, state=s.used) {
  const calls=[];
  return {calls,provider:{watchForTxData:async()=>data,queryContractState:async(_address,config)=>{calls.push(config);return config.blockHash===HEAD?s.active:state;}}};
}
const node={finalizedHead:async()=>({hash:HEAD,height:10}),assertFinalizedCanonical:async()=>{}};

test('real SDK public redeem transcript plus independent finalized-block state admits once',async t=>{
  const s=await sdk(),p=providerFor(s),f=fixture();t.after(f.close);
  const reader=createVerifiedChainReader(s.event,p.provider,node),service=new GateService({store:f.store,auth:new GateAuth({north:KEY_A}),events:[{event:s.event,reader}]});
  const request={...s.event,commitment:s.commitment,requestId:'synthetic-real-sdk-0001'};
  await service.openRedemption('north',AUTH_A,request);const result=await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:s.redeem.txId});
  assert.equal(result.admit,true);assert.deepEqual(p.calls,[{type:'blockHash',blockHash:HEAD},{type:'blockHash',blockHash:BLOCK}]);assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:s.redeem.txId})).admit,false);
});
test('latest USED or unrelated successful transaction never substitutes for exact typed attribution',async()=>{
  const s=await sdk();
  for(const data of [s.issue,s.revoke,{...s.redeem,status:'FailFallible'},{...s.redeem,tx:undefined}]){
    const p=providerFor(s,data),reader=createVerifiedChainReader(s.event,p.provider,node);
    await assert.rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-attribution-0001',baselineBlockHeight:10},data.txId));
  }
  const reader=createVerifiedChainReader(s.event,providerFor(s).provider,node);
  await assert.rejects(reader.verifyRedemption({...s.event,commitment:'77'.repeat(32),requestId:'synthetic-attribution-0002',baselineBlockHeight:10},s.redeem.txId),/expected contract/);
});
test('server ACTIVE baseline rejects real generated USED, REVOKED and never-issued states',async()=>{
  const s=await sdk(),request={...s.event,commitment:s.commitment,requestId:'synthetic-baseline-0001'};
  for(const state of [s.used,s.revoked,null]){
    const reader=createVerifiedChainReader(s.event,{queryContractState:async()=>state},node);
    await rejects(reader.readActiveBaseline(request),'not-active');
  }
});
test('canonical and submitted identifiers may differ: reader → service → SQLite commit keeps bound alias',async t=>{
  const s=await sdk(),f=fixture();t.after(f.close);
  // Alias metadata fixture wraps an actual SDK public transaction, retaining its actual typed transcript.
  const realIds=s.redeem.tx.identifiers(),alias=realIds.find(id=>id!==s.redeem.txId)??ALIAS;
  const tx={intents:s.redeem.tx.intents,identifiers:()=>[...realIds,alias]};
  const data={...s.redeem,tx,identifiers:[...realIds,alias]};const p=providerFor(s,data);
  const reader=createVerifiedChainReader(s.event,p.provider,node),service=new GateService({store:f.store,auth:f.auth,events:[{event:s.event,reader}]});
  const request={...s.event,commitment:s.commitment,requestId:'synthetic-alias-request-0001'};
  await service.openRedemption('north',AUTH_A,request);const result=await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:alias});
  assert.equal(result.admit,true);assert.equal(result.receipt.txId,s.redeem.txId);assert.equal(f.store.get(request.requestId,'north').txId,alias);
  assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:alias})).admit,false);
});
test('indexer-only invented alias is rejected when typed public tx has no such identifier',async()=>{
  const s=await sdk(),data={...s.redeem,identifiers:[...s.redeem.identifiers,ALIAS]};
  const reader=createVerifiedChainReader(s.event,providerFor(s,data).provider,node);
  await rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-alias-spoof-0001',baselineBlockHeight:10},ALIAS),'verification-failed');
});
test('prebaseline/same-block consumption and noncanonical/nonfinalized node evidence fail closed',async()=>{
  const s=await sdk();
  for(const data of [{...s.redeem,blockHeight:10},{...s.redeem,blockHeight:9}]){
    const reader=createVerifiedChainReader(s.event,providerFor(s,data).provider,node);
    await rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-stale-0001',baselineBlockHeight:10},s.redeem.txId),'verification-failed');
  }
  const reader=createVerifiedChainReader(s.event,providerFor(s).provider,{...node,assertFinalizedCanonical:async()=>{throw new GateError('verification-failed',503);}});
  await rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-finality-0001',baselineBlockHeight:10},s.redeem.txId),'verification-failed');
});
test('independent Node RPC pins finalized head/header and exact canonical block hash',async()=>{
  const methods=[];
  const rpc=new ReadOnlyNode('https://node.example',1000,async(url,options)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');const request=JSON.parse(options.body);methods.push([request.method,request.params]);
    const result=request.method==='chain_getFinalizedHead'?`0x${HEAD}`:request.method==='chain_getHeader'?{number:'0x14'}:`0x${BLOCK}`;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  });
  await rpc.assertFinalizedCanonical(BLOCK,11);assert.deepEqual(methods,[['chain_getFinalizedHead',[]],['chain_getHeader',[`0x${HEAD}`]],['chain_getBlockHash',[11]]]);
  await rejects(rpc.assertFinalizedCanonical(BLOCK,21),'verification-failed');await rejects(rpc.assertFinalizedCanonical(TX,11),'verification-failed');
});
test('node rejects embedded credentials, non-TLS remote URI and malformed/error response',async()=>{
  const credentialUrl = new URL('https://node.example'); credentialUrl.username = 'synthetic-user'; credentialUrl.password = 'synthetic-password';
  assert.throws(()=>new ReadOnlyNode(credentialUrl.href),/unauthenticated/);assert.throws(()=>new ReadOnlyNode('http://node.example'),/TLS/);
  const rpc=new ReadOnlyNode('https://node.example',1000,async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{message:'private-provider-error'}})));
  await rejects(rpc.finalizedHead(),'verification-failed');
});
test('runtime node method allowlist prevents arbitrary RPC even from untyped callers',async()=>{
  let calls=0;const rpc=new ReadOnlyNode('https://node.example',1000,async()=>{calls++;throw new Error('must-not-contact');});
  await rejects(rpc.rpc('author_submitExtrinsic',['not-a-transaction']),'verification-failed');assert.equal(calls,0);
});
test('global SDK network drift fails closed before chain reads',async()=>{
  const s=await sdk();let reads=0;const reader=createVerifiedChainReader(s.event,{queryContractState:async()=>{reads++;return s.active;}},node);
  setNetworkId('preprod');try{await assert.rejects(reader.readActiveBaseline({...s.event,commitment:s.commitment,requestId:'synthetic-network-drift-0001'}),/network changed/);}finally{setNetworkId('preview');}
  assert.equal(reads,0);
});

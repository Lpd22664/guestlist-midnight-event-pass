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
  return {verifierKeys:await zkConfigProvider.getVerifierKeys(['issue','redeem','revoke']),event:{network:'preview',contractAddress,eventId:hex(eventId),issuerCommitment:hex(issuerCommitment)},commitment:hex(commitment),active,used,revoked,redeem:dataFor(redeem),issue:dataFor(issue),revoke:dataFor(revoke)};
}
let sdkPromise; const sdk=()=>sdkPromise??=actualSdkFixture();
function providerFor(s, data=s.redeem, state=s.used) {
  const calls=[];
  return {calls,provider:{watchForTxData:async()=>data,queryContractState:async(_address,config)=>{calls.push(config);return config.blockHash===HEAD?s.active:state;}}};
}
const asOf = state => ({readContractState: async () => state});
const node={finalizedHead:async()=>({hash:HEAD,height:10}),assertFinalizedCanonical:async()=>{}};

test('real SDK public redeem transcript plus independent finalized-block state admits once',async t=>{
  const s=await sdk(),p=providerFor(s),f=fixture();t.after(f.close);
  const reader=createVerifiedChainReader(s.event,p.provider,node,asOf(s.active)),service=new GateService({store:f.store,auth:new GateAuth({north:KEY_A}),events:[{event:s.event,reader}]});
  const request={...s.event,commitment:s.commitment,requestId:'synthetic-real-sdk-0001'};
  await service.openRedemption('north',AUTH_A,request);const result=await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:s.redeem.txId});
  assert.equal(result.admit,true);assert.deepEqual(p.calls,[{type:'blockHash',blockHash:BLOCK}]);assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:s.redeem.txId})).admit,false);
});
test('latest USED or unrelated successful transaction never substitutes for exact typed attribution',async()=>{
  const s=await sdk();
  for(const data of [s.issue,s.revoke,{...s.redeem,status:'FailFallible'},{...s.redeem,tx:undefined}]){
    const p=providerFor(s,data),reader=createVerifiedChainReader(s.event,p.provider,node,asOf(s.active));
    await assert.rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-attribution-0001',baselineBlockHeight:10},data.txId));
  }
  const reader=createVerifiedChainReader(s.event,providerFor(s).provider,node,asOf(s.active));
  await assert.rejects(reader.verifyRedemption({...s.event,commitment:'77'.repeat(32),requestId:'synthetic-attribution-0002',baselineBlockHeight:10},s.redeem.txId),/expected contract/);
});
test('server ACTIVE baseline rejects real generated USED, REVOKED and never-issued states',async()=>{
  const s=await sdk(),request={...s.event,commitment:s.commitment,requestId:'synthetic-baseline-0001'};
  for(const state of [s.used,s.revoked,null]){
    const reader=createVerifiedChainReader(s.event,{queryContractState:async()=>state},node,asOf(state));
    await rejects(reader.readActiveBaseline(request),'not-active');
  }
});
test('canonical and submitted identifiers may differ: reader → service → SQLite commit keeps bound alias',async t=>{
  const s=await sdk(),f=fixture();t.after(f.close);
  // Alias metadata fixture wraps an actual SDK public transaction, retaining its actual typed transcript.
  const realIds=s.redeem.tx.identifiers(),alias=realIds.find(id=>id!==s.redeem.txId)??ALIAS;
  const tx={intents:s.redeem.tx.intents,identifiers:()=>[...realIds,alias]};
  const data={...s.redeem,tx,identifiers:[...realIds,alias]};const p=providerFor(s,data);
  const reader=createVerifiedChainReader(s.event,p.provider,node,asOf(s.active)),service=new GateService({store:f.store,auth:f.auth,events:[{event:s.event,reader}]});
  const request={...s.event,commitment:s.commitment,requestId:'synthetic-alias-request-0001'};
  await service.openRedemption('north',AUTH_A,request);const result=await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:alias});
  assert.equal(result.admit,true);assert.equal(result.receipt.txId,s.redeem.txId);assert.equal(f.store.get(request.requestId,'north').txId,alias);
  assert.equal((await service.claimRedemption('north',AUTH_A,{requestId:request.requestId,txId:alias})).admit,false);
});
test('indexer-only invented alias is rejected when typed public tx has no such identifier',async()=>{
  const s=await sdk(),data={...s.redeem,identifiers:[...s.redeem.identifiers,ALIAS]};
  const reader=createVerifiedChainReader(s.event,providerFor(s,data).provider,node,asOf(s.active));
  await rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-alias-spoof-0001',baselineBlockHeight:10},ALIAS),'verification-failed');
});
test('prebaseline/same-block consumption and noncanonical/nonfinalized node evidence fail closed',async()=>{
  const s=await sdk();
  for(const data of [{...s.redeem,blockHeight:10},{...s.redeem,blockHeight:9}]){
    const reader=createVerifiedChainReader(s.event,providerFor(s,data).provider,node,asOf(s.active));
    await rejects(reader.verifyRedemption({...s.event,commitment:s.commitment,requestId:'synthetic-stale-0001',baselineBlockHeight:10},s.redeem.txId),'verification-failed');
  }
  const reader=createVerifiedChainReader(s.event,providerFor(s).provider,{...node,assertFinalizedCanonical:async()=>{throw new GateError('verification-failed',503);}},asOf(s.active));
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
  const s=await sdk();let reads=0;const reader=createVerifiedChainReader(s.event,{queryContractState:async()=>{reads++;return s.active;}},node,{readContractState:async()=>{reads++;return s.active;}});
  setNetworkId('preprod');try{await assert.rejects(reader.readActiveBaseline({...s.event,commitment:s.commitment,requestId:'synthetic-network-drift-0001'}),/network changed/);}finally{setNetworkId('preview');}
  assert.equal(reads,0);
});

// The public provider above deliberately models SDK exact-action-block semantics.
// These regressions exercise the separate HTTP as-of path with genuine SDK states.
const { ReadOnlyAsOfIndexer, localPinnedStateVerifier } = await import('../dist/as-of-state.js');
const json = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
function indexed(s, baseline, state=s.active) {
  return {data:{anchor:{hash:baseline.hash,height:baseline.height},contract:state?{address:s.event.contractAddress,state:hex(state.serialize())}:null}};
}
const baseline = {hash:HEAD,height:10};
const requestFor = s => ({...s.event,commitment:s.commitment,requestId:'synthetic-asof-baseline-0001'});

test('idle finalized head inherits older ACTIVE state without any exact-action or latest fallback',async()=>{
  const s=await sdk();let queries=0,canonicalChecks=0;
  const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async(url,options)=>{
    queries++;const body=JSON.parse(options.body);
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    assert.deepEqual(body.variables,{address:s.event.contractAddress,hash:HEAD});
    assert.match(body.query,/anchor: block\(offset: \{hash: \$hash\}\)/);
    assert.match(body.query,/contract\(address: \$address, offset: \{hash: \$hash\}\)/);
    assert.doesNotMatch(body.query,/contractAction|actions\(/);
    return json(indexed(s,baseline));
  });
  const reader=createVerifiedChainReader(s.event,{queryContractState:async()=>{throw new Error('Exact action is absent at idle head');}},
    {...node,assertFinalizedCanonical:async(hash,height)=>{canonicalChecks++;assert.equal(hash,HEAD);assert.equal(height,10);}},asOf);
  assert.deepEqual(await reader.readActiveBaseline(requestFor(s)),baseline);assert.equal(queries,1);assert.equal(canonicalChecks,1);
});

test('as-of query selects the latest update no later than the anchor, including several updates and an action at the anchor',async()=>{
  const s=await sdk();const blocks=new Map([[HEAD,10],[BLOCK,11],[TX,12]]),updates=[{height:8,state:s.active},{height:11,state:s.used},{height:12,state:s.revoked}];
  const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async(url,options)=>{
    const body=JSON.parse(options.body),height=blocks.get(body.variables.hash);
    assert.ok(height);const state=updates.filter(update=>update.height<=height).at(-1).state;
    return json(indexed(s,{hash:body.variables.hash,height},state));
  });
  for(const [hash,height] of blocks){
    const reader=createVerifiedChainReader(s.event,{}, {...node,finalizedHead:async()=>({hash,height})},asOf);
    if(height===10) assert.deepEqual(await reader.readActiveBaseline(requestFor(s)),{hash,height});
    else await rejects(reader.readActiveBaseline(requestFor(s)),'not-active');
  }
});

test('wrong, stale, missing and future indexer anchors fail closed before decoding or baseline creation',async()=>{
  const s=await sdk();
  for(const anchor of [null,{}, {hash:BLOCK,height:10},{hash:HEAD,height:9},{hash:HEAD,height:11},{hash:HEAD,height:'10'},{hash:'bad',height:10}]){
    const data=indexed(s,baseline);data.data.anchor=anchor;
    const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async()=>json(data));
    await rejects(asOf.readContractState(s.event.contractAddress,baseline),'verification-failed');
  }
});

test('malformed/partial/error/wrong-contract public state is rejected without a latest fallback',async()=>{
  const s=await sdk(),good=indexed(s,baseline);
  const values=[{}, {data:null}, {data:{anchor:good.data.anchor}}, {...good,errors:[{message:'synthetic-private-provider-detail'}]}, {...good,errors:{}},
    {data:{...good.data,contract:{...good.data.contract,address:TX}}}, ...['0','zz','','ff'].map(state=>({data:{...good.data,contract:{...good.data.contract,state}}}))];
  for(const value of values){
    let calls=0;const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async()=>{calls++;return json(value);});
    await rejects(asOf.readContractState(s.event.contractAddress,baseline),'verification-failed');assert.equal(calls,1);
  }
});

test('absent contract and never-issued commitment are not ACTIVE, while wrong event/issuer/request identity fails closed',async()=>{
  const s=await sdk();
  const absent=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async()=>json(indexed(s,baseline,null)));
  await rejects(createVerifiedChainReader(s.event,{},node,absent).readActiveBaseline(requestFor(s)),'not-active');
  await rejects(createVerifiedChainReader(s.event,{},node,asOf(s.active)).readActiveBaseline({...requestFor(s),commitment:TX}),'not-active');
  for(const field of ['eventId','issuerCommitment']){
    const event={...s.event,[field]:TX};
    await rejects(createVerifiedChainReader(event,{},node,asOf(s.active)).readActiveBaseline({...requestFor(s),...event}),'not-active');
  }
  for(const field of ['contractAddress','eventId','issuerCommitment','network']){
    const request={...requestFor(s),[field]:field==='network'?'preprod':TX};
    await rejects(createVerifiedChainReader(s.event,{},node,asOf(s.active)).readActiveBaseline(request),'event-not-configured');
  }
});

test('reorg/unfinalized finality recheck cannot open ACTIVE attempt or fall back to a different head',async()=>{
  const s=await sdk();let reads=0;
  for(const cause of ['reorg','unfinalized']){
    const reader=createVerifiedChainReader(s.event,{}, {...node,assertFinalizedCanonical:async()=>{throw new GateError('verification-failed',503,cause);}},
      {readContractState:async()=>{reads++;return s.active;}});
    await rejects(reader.readActiveBaseline(requestFor(s)),'verification-failed');
  }
  assert.equal(reads,2);
});

test('pinned verifier keys and exact operation set are checked on both ACTIVE and receipt snapshots',async()=>{
  const s=await sdk();
  const wrongKeys=ContractState.deserialize(s.active.serialize());wrongKeys.setOperation('redeem',s.active.operation('issue'));
  const extraOperation=ContractState.deserialize(s.active.serialize());extraOperation.setOperation('other',s.active.operation('issue'));
  for(const state of [wrongKeys,extraOperation]){
    await assert.rejects(createVerifiedChainReader(s.event,{},node,asOf(state)).readActiveBaseline(requestFor(s)));
    state.data=s.used.data;
    const reader=createVerifiedChainReader(s.event,providerFor(s,s.redeem,state).provider,node,asOf(s.active));
    await assert.rejects(reader.verifyRedemption({...requestFor(s),baselineBlockHeight:10},s.redeem.txId));
  }
  // An empty/subset injected key provider can never rely on the SDK's vacuous success.
  const {createPinnedStateVerifier}=await import('../../browser-integration/dist/state-integrity.js');
  await assert.rejects(createPinnedStateVerifier({getVerifierKeys:async()=>[]})(s.active),/Incomplete/);
});

test('offline, HTTP failure, invalid JSON/type and oversized streamed indexer replies are bounded and redacted',async()=>{
  const s=await sdk();let cancelled=false;
  const cases=[async()=>{throw new Error('synthetic-private-provider-detail');},async()=>new Response('',{status:503}),async()=>new Response('{bad',{headers:{'content-type':'application/json'}}),async()=>new Response('{}'),
    async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(4*1024*1024+1)}}),
    async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4*1024*1024+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})];
  for(const fetchImpl of cases){
    const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,fetchImpl);
    await assert.rejects(asOf.readContractState(s.event.contractAddress,baseline),error=>error.code==='verification-failed'&&!error.message.includes('private'));
  }
  assert.equal(cancelled,true);
});

test('as-of timeout aborts the HTTP read and invalid public endpoint/baseline never contacts a service',async()=>{
  const s=await sdk();const keepAlive=setTimeout(()=>{},1000);
  try{
    const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',10,async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})));
    await rejects(asOf.readContractState(s.event.contractAddress,baseline),'verification-failed');
  }finally{clearTimeout(keepAlive);}
  assert.throws(()=>new ReadOnlyAsOfIndexer('http://indexer.example/graphql'));
  assert.throws(()=>new ReadOnlyAsOfIndexer('https://indexer.example/graphql?secret=x'));
  let calls=0;const reader=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async()=>{calls++;return json({});});
  for(const bad of [{hash:HEAD,height:-1},{hash:HEAD,height:1.1},{hash:'bad',height:10}]) await rejects(reader.readContractState(s.event.contractAddress,bad),'verification-failed');
  assert.equal(calls,0);
});

test('early HTTP/type/length refusals cancel the response stream immediately',async()=>{
  const s=await sdk();
  for(const options of [{status:503,headers:{'content-type':'application/json'}},{headers:{'content-type':'text/html'}},{headers:{'content-type':'application/json','content-length':String(4*1024*1024+1)}}]){
    let cancelled=false;
    const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),options));
    await rejects(asOf.readContractState(s.event.contractAddress,baseline),'verification-failed');assert.equal(cancelled,true);
  }
});

test('indexer timeout also bounds a stalled streamed response after its headers',async()=>{
  const s=await sdk();let cancelled=false;
  const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',10,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
  await rejects(asOf.readContractState(s.event.contractAddress,baseline),'verification-failed');assert.equal(cancelled,true);
});

test('fragmented streamed responses enforce the cumulative byte cap',async()=>{
  const s=await sdk();let chunks=0,cancelled=false;
  const asOf=new ReadOnlyAsOfIndexer('https://indexer.example/graphql',1000,async()=>new Response(new ReadableStream({pull(controller){chunks++;controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));
  await rejects(asOf.readContractState(s.event.contractAddress,baseline),'verification-failed');assert.equal(cancelled,true);assert.ok(chunks>=5&&chunks<=6);
});

test('nonempty key subsets fail closed, and a failed pinned-key load can recover on the next read',async()=>{
  const s=await sdk();const {createPinnedStateVerifier}=await import('../../browser-integration/dist/state-integrity.js');
  await assert.rejects(createPinnedStateVerifier({getVerifierKeys:async()=>s.verifierKeys.slice(0,2)})(s.active),/Incomplete/);
  let loads=0;const verify=createPinnedStateVerifier({getVerifierKeys:async()=>{if(++loads===1)throw new Error('synthetic key read failure');return s.verifierKeys;}});
  await assert.rejects(verify(s.active),/synthetic key read failure/);await verify(s.active);await verify(s.used);assert.equal(loads,2);
});

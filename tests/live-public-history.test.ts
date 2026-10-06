import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveController } from '../src/live/controller';
import { PublicHistory, PUBLIC_HISTORY_LOCK_NAME, type PublicHistoryLock } from '../src/live/public-history';
import { PUBLIC_STORAGE_KEY, loadPublicAttempts, hexFromBytes, type BrowserSession, type PublicAttempt, type PublicReceipt, type Role, type Sdk } from '../src/live/model';
import type { Attempt } from '../browser-integration/dist/journal.js';
import { sharedHistoryLock } from './live-history-lock-fixture';
const eventId='11'.repeat(32), contract='22'.repeat(32), issuer='33'.repeat(32), commitment='44'.repeat(32);
const manifest={network:'preview',contractAddress:contract,eventId,issuerCommitment:issuer};
function receipt(action:'issue'|'redeem'='issue'):PublicReceipt {
 const txId=(action==='issue'?'aa':'bb').repeat(33);
 return {schema:'midnight-event-pass-receipt-v1',network:'preview',action,contractAddress:contract,txId,identifiers:[txId],txHash:'cc'.repeat(32),blockHash:'dd'.repeat(32),blockHeight:42,blockTimestamp:1,transactionStatus:'SucceedEntirely',stateCheck:'verified-at-finalized-block',eventId,commitment,publicState:{eventId,issuerCommitment:issuer,issuedCount:'1',redeemedCount:action==='redeem'?'1':'0',revokedCount:'0',passStatus:action==='redeem'?'USED':'ACTIVE'}};
}
function sdkAttempt(requestId:string,state:Attempt['state']='verified',action:'issue'|'redeem'='issue'):Attempt {
 return {requestId,network:'preview',action,eventId,issuerCommitment:issuer,contractAddress:contract,commitment,state,expiresAt:Date.now()+10000,...(state==='verified'?{txId:receipt(action).txId,receipt:receipt(action)}:{})};
}
function row(requestId:string,status:PublicAttempt['status']='unknown'):PublicAttempt {
 return {requestId,action:'issue',ownerAccountId:'synthetic-owner',eventId,role:'issuer',commitment,status,...(status==='verified'?{receipt:receipt()}:{})};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};}
/** Only explicit synthetic providers, fixture capabilities and local Map transport. No real owner/wallet/network operation. */
function environment() {
 const data=new Map<string,string>(), lock=sharedHistoryLock(), journals=new Map<Role,Map<string,Attempt>>([['issuer',new Map()],['bearer',new Map()]]);
 let writeFailure=false, readFailure=false, sdkReadFailure=false;
 const effects:Array<{role:Role;requestId:string;action:'issue'|'redeem'}>=[];let reads=0,reconciles=0;
 let pause:{began:ReturnType<typeof deferred<void>>;done:ReturnType<typeof deferred<void>>}|undefined;
 const storage={getItem:(key:string)=>{if(readFailure&&key===PUBLIC_STORAGE_KEY)throw Error('Synthetic storage read failure');return data.get(key)??null},setItem:(key:string,value:string)=>{if(writeFailure&&key===PUBLIC_STORAGE_KEY)throw Error('Synthetic storage write failure');data.set(key,value)}};
 function make(role:Role='issuer',requestId='issuer-request-1', options:{lock?:PublicHistoryLock|null; native?:boolean}={}) {
  const journal=journals.get(role)!;let closed=false;let unknown=false;
  const execute=async(id:string,action:'issue'|'redeem',passCommitment=commitment)=>{
   assert.ok(loadPublicAttempts(storage).some(item=>item.requestId===id&&item.status==='pending'),'public reservation must commit before the SDK effect');
   effects.push({role,requestId:id,action});journal.set(id,{...sdkAttempt(id,'unknown',action),commitment:passCommitment});
   if(pause){pause.began.resolve();await pause.done.promise;}
   if(unknown)throw Error('Synthetic interrupted submission');
   const base=sdkAttempt(id,'verified',action), final={...base,commitment:passCommitment,receipt:{...base.receipt!,commitment:passCommitment}};journal.set(id,final);return final.receipt;
  };
  const session={scope:{network:'preview',ownerAccountId:'synthetic-owner',eventId,role},configuration:{networkId:'preview',indexerUri:'https://synthetic.invalid/indexer',indexerWsUri:'wss://synthetic.invalid/indexer',substrateNodeUri:'https://synthetic.invalid/node'},adapter:{join:async()=>{},issue:(id:string,value:Uint8Array)=>execute(id,'issue',hexFromBytes(value)),redeem:(id:string,value:Uint8Array)=>execute(id,'redeem',hexFromBytes(value))},checkConnection:async()=>{},close:()=>{closed=true},readAttempt:async(id:string)=>{reads++;if(closed||sdkReadFailure)throw Error('Synthetic SDK journal read error; not absence');return journal.get(id)??null},reconcile:async(id:string)=>{reconciles++;return journal.get(id)?.receipt??null}} as unknown as BrowserSession;
  const sdk={createBrowserSession:async()=>{closed=false;return session},readChainStatus:async()=>({network:'preview',nodeVersion:'synthetic',finalizedBlockHash:'dd'.repeat(32),finalizedBlockHeight:42,checkedAt:'2026-10-05T00:00:00Z'}),createReadOnlyPublicProvider:()=>({}),readPublicState:async()=>receipt().publicState,derivePassCommitment:()=>new Uint8Array(32).fill(0x44)} as unknown as Sdk;
  const c=new LiveController({storage,...(options.native?{}:{publicHistoryLock:options.lock===undefined?lock:options.lock}),loadSdk:async()=>sdk,requestId:()=>requestId,assets:()=> 'https://synthetic.invalid/assets/'});
  c.consent.subscribe(()=>{if(c.consent.getSnapshot())queueMicrotask(()=>c.consent.respond(true))});
  const ready=async()=>{await c.load();c.setCustody({role,ownerAccountId:'synthetic-owner',eventId,encryptionKey:{} as CryptoKey,capability:new Uint8Array(32).fill(1)});await c.connect({} as never,'synthetic-prover');await c.readNetwork();await c.join(manifest)};
  return{c,session,ready,journal,setRequestId:(value:string)=>{requestId=value},setUnknown:()=>{unknown=true}};
 }
 return{data,storage,lock,journals,effects,make,reads:()=>reads,reconciles:()=>reconciles,setWriteFailure:(value:boolean)=>{writeFailure=value},setReadFailure:(value:boolean)=>{readFailure=value},setSdkReadFailure:(value:boolean)=>{sdkReadFailure=value},pause:()=>{pause={began:deferred<void>(),done:deferred<void>()};return pause}};
}
for(const outcome of ['verified','unknown'] as const)test(`stale bearer tab preserves issuer ${outcome} request across reload and read-only reconciliation`,async()=>{
 const env=environment(),issuerTab=env.make(),bearerTab=env.make('bearer');await issuerTab.ready();await bearerTab.ready();if(outcome==='unknown')issuerTab.setUnknown();
 await issuerTab.c.issue(commitment);assert.equal(issuerTab.c.getSnapshot().attempts[0].status,outcome);assert.equal(bearerTab.c.getSnapshot().attempts.length,0);
 await bearerTab.c.redeem('bearer-gate-request-1',commitment);const persisted=loadPublicAttempts(env.storage);assert.equal(persisted.length,2);assert.equal(persisted.find(item=>item.requestId==='issuer-request-1')?.status,outcome);
 const reloaded=env.make();await reloaded.ready();const before=env.reads();await reloaded.c.reconcile('issuer-request-1');assert.ok(env.reads()>before);assert.equal(reloaded.c.getSnapshot().attempts.length,2);assert.equal(env.effects.length,2);
 if(outcome==='unknown'){await reloaded.c.issue(commitment);assert.equal(env.effects.length,2);issuerTab.journal.set('issuer-request-1',sdkAttempt('issuer-request-1'));await reloaded.c.reconcile('issuer-request-1');assert.equal(reloaded.c.getSnapshot().attempts.find(item=>item.requestId==='issuer-request-1')?.status,'verified');assert.equal(env.effects.length,2)}
});
test('simultaneous issuer reservations serialize unresolved checks and permit only one SDK effect',async()=>{
 const env=environment(),a=env.make('issuer','issuer-request-a'),b=env.make('issuer','issuer-request-b');await a.ready();await b.ready();const pause=env.pause();
 const first=a.c.issue(commitment);await pause.began.promise;await b.c.issue(commitment);assert.equal(env.effects.length,1);assert.equal(loadPublicAttempts(env.storage).length,1);pause.done.resolve();await first;assert.equal(loadPublicAttempts(env.storage)[0].status,'verified');
});
test('simultaneous different-role SDK writers retain both public histories',async()=>{
 const env=environment(),a=env.make(),b=env.make('bearer');await a.ready();await b.ready();await Promise.all([a.c.issue(commitment),b.c.redeem('bearer-gate-request-1',commitment)]);assert.equal(loadPublicAttempts(env.storage).length,2);assert.equal(env.effects.length,2);
});
test('all history helpers share one named lock and concurrent merges lose no rows',async()=>{
 const env=environment();let active=0,max=0;const names=new Set<string>();
 const observed:PublicHistoryLock={request:(name,operation)=>env.lock.request(name,async()=>{names.add(name);active++;max=Math.max(max,active);await Promise.resolve();try{return await operation()}finally{active--}})};
 await Promise.all(Array.from({length:40},(_,i)=>new PublicHistory(env.storage,observed).merge([row(`parallel-request-${i}`)])));
 assert.equal(loadPublicAttempts(env.storage).length,40);assert.equal(max,1);assert.deepEqual([...names],[PUBLIC_HISTORY_LOCK_NAME]);
});
test('stale status writes cannot downgrade verified receipts or uncertainty, and collisions are rejected atomically',async()=>{
 const env=environment(),history=new PublicHistory(env.storage,env.lock);await history.merge([row('verified-request-1','verified'),row('unknown-request-1')]);
 await Promise.all([history.merge([row('verified-request-1','pending')]),history.merge([row('verified-request-1')]),history.merge([row('unknown-request-1','pending')])]);
 assert.equal(loadPublicAttempts(env.storage).find(item=>item.requestId==='verified-request-1')?.status,'verified');assert.equal(loadPublicAttempts(env.storage).find(item=>item.requestId==='unknown-request-1')?.status,'unknown');
 const before=env.data.get(PUBLIC_STORAGE_KEY);
 for(const change of [{ownerAccountId:'different-owner'},{eventId:'55'.repeat(32)},{role:'bearer' as const},{action:'revoke' as const},{commitment:'66'.repeat(32)}])await assert.rejects(history.merge([{...row('unknown-request-1'),...change}]),/collision/);
 await assert.rejects(history.merge([{...row('verified-request-1','verified'),receipt:{...receipt(),blockHash:'77'.repeat(32)}}]),/collision/);assert.equal(env.data.get(PUBLIC_STORAGE_KEY),before);
});
test('missing atomic locks fail closed before any SDK transaction effect',async()=>{
 const env=environment(),tab=env.make('issuer','no-lock-request-1',{lock:null});await tab.ready();await tab.c.issue(commitment);assert.equal(env.effects.length,0);assert.equal(env.data.has(PUBLIC_STORAGE_KEY),false);assert.match(tab.c.getSnapshot().error,/Web Locks/);
});
test('storage failure before reservation blocks SDK effects and does not reset existing history',async()=>{
 const env=environment();await new PublicHistory(env.storage,env.lock).merge([row('other-request-1','verified')]);const tab=env.make();await tab.ready();const before=env.data.get(PUBLIC_STORAGE_KEY);env.setWriteFailure(true);await tab.c.issue(commitment);assert.equal(env.effects.length,0);assert.equal(env.data.get(PUBLIC_STORAGE_KEY),before);assert.match(tab.c.getSnapshot().error,/durably persisted/);
});
test('post-submission public persistence failure remains unknown and reload recovers authoritative finalized SDK receipt without resubmission',async()=>{
 const env=environment(),tab=env.make();await tab.ready();const original=tab.session.adapter.issue;tab.session.adapter.issue=async(...args)=>{const final=await original(...args);env.setWriteFailure(true);return final};
 await tab.c.issue(commitment);assert.equal(env.effects.length,1);assert.equal(tab.c.getSnapshot().attempts[0].status,'unknown');assert.equal(loadPublicAttempts(env.storage)[0].status,'pending');assert.equal(tab.journal.get('issuer-request-1')?.state,'verified');assert.equal(tab.c.getSnapshot().state,undefined);
 env.setWriteFailure(false);const reloaded=env.make();await reloaded.ready();await reloaded.c.reconcile('issuer-request-1');assert.equal(reloaded.c.getSnapshot().attempts[0].status,'verified');assert.equal(env.effects.length,1);
});
test('SDK read errors and null journal reads never establish failed/absent submission',async()=>{
 const env=environment(),tab=env.make();await tab.ready();tab.setUnknown();await tab.c.issue(commitment);env.setSdkReadFailure(true);await tab.c.reconcile('issuer-request-1');assert.equal(loadPublicAttempts(env.storage)[0].status,'unknown');assert.doesNotMatch(tab.c.getSnapshot().error,/Synthetic SDK journal/);
 env.setSdkReadFailure(false);tab.journal.delete('issuer-request-1');await tab.c.reconcile('issuer-request-1');assert.equal(loadPublicAttempts(env.storage)[0].status,'unknown');assert.match(tab.c.getSnapshot().message,/does not establish failure/);assert.equal(env.effects.length,1);
});
test('known request missing from UI is reconstructed only from the exact unlocked authoritative SDK scope',async()=>{
 const env=environment(),tab=env.make();await tab.ready();tab.journal.set('recovered-request-1',sdkAttempt('recovered-request-1'));await tab.c.reconcile('recovered-request-1');const recovered=loadPublicAttempts(env.storage)[0];assert.equal(recovered.requestId,'recovered-request-1');assert.equal(recovered.ownerAccountId,'synthetic-owner');assert.equal(recovered.role,'issuer');assert.equal(recovered.status,'verified');assert.equal(env.effects.length,0);assert.equal(env.reconciles(),1);
});
test('authoritative missing-row recovery rejects wrong event/network/role/issuer/contract/request/receipt and private extras',async()=>{
 const changes=[{network:'preprod'},{eventId:'55'.repeat(32)},{action:'redeem'},{issuerCommitment:'66'.repeat(32)},{contractAddress:'77'.repeat(32)},{requestId:'wrong-request-id'},{txId:'99'.repeat(33)},{issuerSecret:new Uint8Array(32).fill(8)}];
 for(const change of changes){const env=environment(),tab=env.make();await tab.ready();tab.journal.set('recovered-request-1',{...sdkAttempt('recovered-request-1'),...change} as Attempt);await tab.c.reconcile('recovered-request-1');assert.equal(env.data.has(PUBLIC_STORAGE_KEY),false);assert.equal(env.reconciles(),0);assert.equal(env.effects.length,0)}
});
test('reconciliation refreshes a stale controller and rejects SDK identity collisions without overwriting shared rows',async()=>{
 const env=environment(),stale=env.make();await stale.ready();await new PublicHistory(env.storage,env.lock).merge([row('recover-collision-1')]);stale.journal.set('recover-collision-1',{...sdkAttempt('recover-collision-1'),commitment:'88'.repeat(32),receipt:{...receipt(),commitment:'88'.repeat(32)}});const before=env.data.get(PUBLIC_STORAGE_KEY);await stale.c.reconcile('recover-collision-1');assert.equal(env.data.get(PUBLIC_STORAGE_KEY),before);assert.match(stale.c.getSnapshot().error,/collision/);assert.equal(env.reconciles(),0);
});
test('disconnect during delayed lock acquisition cannot reserve, review or invoke a new SDK transaction',async()=>{
 const env=environment(),waiting=deferred<void>(),began=deferred<void>();const delayed:PublicHistoryLock={request:(name,operation)=>env.lock.request(name,async()=>{began.resolve();await waiting.promise;return operation()})};const tab=env.make('issuer','delayed-request-1',{lock:delayed});await tab.ready();const pending=tab.c.issue(commitment);await began.promise;tab.c.disconnect();waiting.resolve();await pending;assert.equal(env.effects.length,0);assert.equal(env.data.has(PUBLIC_STORAGE_KEY),false);assert.equal(tab.c.getSnapshot().connected,false);assert.equal(tab.c.getSnapshot().custodyReady,false);assert.equal(tab.c.consent.getSnapshot(),undefined);assert.equal(tab.c.getSnapshot().message.startsWith('Locked.'),true);
});
test('disconnect while final receipt persistence waits on a lock retains unknown public request and no late success',async()=>{
 const env=environment(),wait=deferred<void>(),began=deferred<void>();let lockCalls=0;const delayed:PublicHistoryLock={request:(name,operation)=>env.lock.request(name,async()=>{lockCalls++;if(lockCalls===2){began.resolve();await wait.promise}return operation()})};const tab=env.make('issuer','late-final-request-1',{lock:delayed});await tab.ready();const pending=tab.c.issue(commitment);await began.promise;tab.c.disconnect();wait.resolve();await pending;assert.equal(loadPublicAttempts(env.storage)[0].status,'unknown');assert.equal(tab.journal.get('late-final-request-1')?.state,'verified');assert.equal(tab.c.getSnapshot().state,undefined);assert.equal(tab.c.getSnapshot().message.startsWith('Locked.'),true);assert.equal(env.effects.length,1);
});
test('native adapter requests the fixed exclusive same-origin Web Lock with no unsafe fallback',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');const env=environment();const calls:Array<{name:string;mode:string}>=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:<T>(name:string,options:{mode:string},callback:()=>Promise<T>)=>{calls.push({name,mode:options.mode});return env.lock.request(name,callback)}}}});
 try{const tab=env.make('issuer','native-request-1',{native:true});await tab.ready();await tab.c.issue(commitment);assert.equal(env.effects.length,1);assert.ok(calls.length>=2);assert.ok(calls.every(call=>call.name===PUBLIC_HISTORY_LOCK_NAME&&call.mode==='exclusive'));assert.equal(loadPublicAttempts(env.storage)[0].status,'verified')}
 finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else Reflect.deleteProperty(globalThis,'navigator')}
});
test('actual native API absence fails closed even when localStorage-like writes are available',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
 try{const env=environment(),tab=env.make('issuer','missing-native-request',{native:true});await tab.ready();await tab.c.issue(commitment);assert.equal(env.effects.length,0);assert.equal(env.data.has(PUBLIC_STORAGE_KEY),false);assert.match(tab.c.getSnapshot().error,/Web Locks/)}
 finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else Reflect.deleteProperty(globalThis,'navigator')}
});
test('silent persistence nonacknowledgement is rejected before SDK effects',async()=>{
 const env=environment();const original=env.storage.setItem;env.storage.setItem=(key,value)=>{if(key!==PUBLIC_STORAGE_KEY)original(key,value)};const tab=env.make();await tab.ready();await tab.c.issue(commitment);assert.equal(env.effects.length,0);assert.equal(env.data.has(PUBLIC_STORAGE_KEY),false);assert.match(tab.c.getSnapshot().error,/not acknowledged/);
});
test('corrupt or unreadable history is never reset, treated as empty or allowed to submit',async()=>{
 for(const corrupt of [false,true]){const env=environment();if(corrupt)env.data.set(PUBLIC_STORAGE_KEY,'{invalid-private-safe-fixture');const tab=env.make();await tab.ready();if(!corrupt)env.setReadFailure(true);const before=env.data.get(PUBLIC_STORAGE_KEY);await tab.c.issue(commitment);assert.equal(env.effects.length,0);assert.equal(env.data.get(PUBLIC_STORAGE_KEY),before)}
});
test('an unresolved-policy rejection refreshes again after read-only reconciliation and does not poison valid history',async()=>{
 const env=environment(),first=env.make('issuer','original-request-a'),stale=env.make('issuer','fresh-request-b');await first.ready();await stale.ready();first.setUnknown();await first.c.issue(commitment);await stale.c.issue(commitment);assert.equal(env.effects.length,1);first.journal.set('original-request-a',sdkAttempt('original-request-a'));await stale.c.reconcile('original-request-a');await stale.c.issue(commitment);assert.equal(env.effects.length,2);assert.equal(loadPublicAttempts(env.storage).length,2);assert.equal(loadPublicAttempts(env.storage).find(row=>row.requestId==='fresh-request-b')?.status,'verified');
});
test('a disconnect after public finalization commit but before lock return cannot show late success or downgrade the durable receipt',async()=>{
 const env=environment();let calls=0;let tab:ReturnType<typeof env.make>;
 const postCommit:PublicHistoryLock={request:(name,operation)=>env.lock.request(name,async()=>{calls++;const result=await operation();if(calls===2)tab.c.disconnect();return result})};
 tab=env.make('issuer','committed-final-request',{lock:postCommit});await tab.ready();await tab.c.issue(commitment);
 assert.equal(loadPublicAttempts(env.storage)[0].status,'verified');assert.equal(tab.c.getSnapshot().attempts[0].status,'unknown');assert.equal(tab.c.getSnapshot().state,undefined);assert.equal(tab.c.getSnapshot().connected,false);assert.equal(tab.c.getSnapshot().message.startsWith('Locked.'),true);assert.equal(env.effects.length,1);
});
test('a cached verified public receipt is not downgraded by missing authoritative journal evidence',async()=>{
 const env=environment();await new PublicHistory(env.storage,env.lock).merge([row('cached-verified-request','verified')]);const tab=env.make();await tab.ready();const before=env.data.get(PUBLIC_STORAGE_KEY);await tab.c.reconcile('cached-verified-request');assert.equal(env.data.get(PUBLIC_STORAGE_KEY),before);assert.equal(tab.c.getSnapshot().attempts[0].status,'verified');assert.match(tab.c.getSnapshot().message,/does not establish failure/);assert.equal(env.reconciles(),0);assert.equal(env.effects.length,0);
});
test('obsolete finalization-lock cancellation permits same-controller reconnect, scoped read-only recovery and one fresh valid request',async()=>{
 const env=environment(),waiting=deferred<void>(),began=deferred<void>();let calls=0;
 const delayed:PublicHistoryLock={request:(name,operation)=>env.lock.request(name,async()=>{calls++;if(calls===2){began.resolve();await waiting.promise}return operation()})};
 const tab=env.make('issuer','cancelled-final-request',{lock:delayed});await tab.ready();
 const first=tab.c.issue(commitment);await began.promise;tab.c.disconnect();waiting.resolve();await first;
 assert.equal(loadPublicAttempts(env.storage)[0].status,'unknown');assert.equal(tab.journal.get('cancelled-final-request')?.state,'verified');assert.equal(env.effects.length,1);
 await tab.ready();await tab.c.reconcile('cancelled-final-request');
 assert.equal(loadPublicAttempts(env.storage)[0].status,'verified');assert.equal(tab.c.getSnapshot().attempts[0].status,'verified');assert.equal(env.effects.length,1,'recovery must not resubmit');
 tab.setRequestId('fresh-valid-request');await tab.c.issue('88'.repeat(32));
 assert.equal(env.effects.length,2);assert.deepEqual(env.effects.map(effect=>effect.requestId),['cancelled-final-request','fresh-valid-request']);assert.equal(loadPublicAttempts(env.storage).find(row=>row.requestId==='fresh-valid-request')?.status,'verified');assert.equal(tab.c.getSnapshot().error,'');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGateHandler } from '../dist/http.js';
import { GateError } from '../dist/types.js';
import { fixture, REQUEST, TX, AUTH_A } from './fixtures.mjs';
async function call(handler,{method='POST',url='/v1/redemptions/open',headers={},body=JSON.stringify(REQUEST)}={}) {
  const request=Readable.from([Buffer.from(body)]);Object.assign(request,{method,url,headers:{'x-gate-id':'north',authorization:AUTH_A,'content-type':'application/json',...headers}});
  const response={headers:{},statusCode:0,setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};
  await handler(request,response);return {...response,json:response.body?JSON.parse(response.body):null};
}
test('HTTP authenticated lifecycle and read-only recovery never trust client receipt',async t=>{
  const f=fixture();t.after(f.close);const handler=createGateHandler(f.service);
  assert.equal((await call(handler)).json.code,'opened');
  const result=await call(handler,{url:'/v1/redemptions/claim',body:JSON.stringify({requestId:REQUEST.requestId,txId:TX})});assert.equal(result.json.admit,true);
  const read=await call(handler,{method:'GET',url:`/v1/redemptions/${REQUEST.requestId}`,body:''});assert.equal(read.json.admit,false);assert.equal(read.json.code,'claimed');
});
test('HTTP auth precedes body parsing and provider errors are redacted',async t=>{
  const f=fixture({reader:{readActiveBaseline:async()=>{throw new Error('private-provider-secret');},verifyRedemption:async()=>{}}});t.after(f.close);const handler=createGateHandler(f.service);
  const unauth=await call(handler,{headers:{authorization:'Bearer invalid'},body:'not-json'});assert.equal(unauth.statusCode,401);
  const failed=await call(handler);assert.equal(failed.json.admit,false);assert.ok(!failed.body.includes('private-provider-secret'));
});
test('HTTP bounded JSON rejects extras/large body/content encoding/query secrets',async t=>{
  const f=fixture();t.after(f.close);const handler=createGateHandler(f.service);
  for(const options of [{body:JSON.stringify({...REQUEST,receipt:{success:true}})},{body:'x'.repeat(2100)},{headers:{'content-encoding':'gzip'}},{url:'/v1/redemptions/open?bearerSecret=must-not-process'}]){const result=await call(handler,options);assert.equal(result.json.admit,false);assert.ok(result.statusCode>=400);}
  assert.equal(f.calls.baseline,0);
});
test('CORS permits only exact owner-approved app origins and no credential cookies',async t=>{
  const f=fixture();t.after(f.close);const handler=createGateHandler(f.service,{allowedOrigins:['https://app.example']});
  const denied=await call(handler,{headers:{origin:'https://evil.example'}});assert.equal(denied.statusCode,403);
  const allowed=await call(handler,{method:'OPTIONS',headers:{origin:'https://app.example'}});assert.equal(allowed.statusCode,204);assert.equal(allowed.headers['Access-Control-Allow-Origin'],'https://app.example');assert.equal(allowed.headers['Access-Control-Allow-Credentials'],undefined);
});

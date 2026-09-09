import test from 'node:test';
import assert from 'node:assert/strict';
import { networkError } from '../lib/studio/network.ts';
void test('network errors distinguish permissions, timeout and DNS without disclosing raw errors',()=>{
 assert.match(networkError({cause:{code:'EACCES'}},'api.deepseek.com').message,/没有外网权限/);
 assert.match(networkError({cause:{errors:[{code:'EPERM'}]}},'api.deepseek.com').message,/没有外网权限/);
 assert.match(networkError({name:'TimeoutError'},'api.deepseek.com').message,/超时/);
 assert.match(networkError({cause:{code:'ENOTFOUND'}},'api.deepseek.com').message,/DNS/);
 assert.ok(!networkError({message:'secret-token'},'api.deepseek.com').message.includes('secret-token'));
});

void test('connection failure differs from inference and body timeouts',()=>{
 assert.match(networkError({cause:{code:'UND_ERR_CONNECT_TIMEOUT'}},'api.deepseek.com').message,/建立到/);
 for(const error of [{name:'TimeoutError'},{cause:{code:'UND_ERR_BODY_TIMEOUT'}},{cause:{code:'UND_ERR_HEADERS_TIMEOUT'}}])assert.match(networkError(error,'api.deepseek.com').message,/完整结果.*可能已处理并计费/);
});

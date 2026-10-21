import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../free-ads.js',import.meta.url),'utf8');
const {normalizeLink,reportTotals}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('safe landing links allow blank and normalize bare hosts',()=>{
 assert.equal(normalizeLink('momoround.com'),'https://momoround.com/');assert.equal(normalizeLink(''),'');
 for(const v of ['javascript:alert(1)','http://example.com','https://u:p@example.com','https://example.com:9999'])assert.throws(()=>normalizeLink(v));
});
test('reports combine campaign days and separate qualified clicks',()=>{
 const rows=reportTotals([{creativeId:'a',title:'a',impressions:3,clicks:2,viewableClicks:1},{creativeId:'a',title:'a',impressions:4,clicks:1,viewableClicks:1}]);
 assert.deepEqual(rows,[{title:'a',impressions:7,clicks:3,viewableClicks:2}]);
});

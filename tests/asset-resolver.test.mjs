import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalog, scoreAsset, resolveAssets } from '../tools/asset-resolver.mjs';

const validAsset = {
  id:'counter',name:'Wooden bar counter',description:'Old saloon furniture',
  tags:['saloon','interior'],style:'stylized',localPath:'assets/library/counter.glb',
  sourceUrl:'https://example.org/asset',license:'CC0-1.0',creator:'Example creator'
};

test('catalog rejects missing provenance and path traversal', () => {
  assert.throws(()=>validateCatalog({version:1,assets:[{...validAsset,license:''}]}),/Missing license/);
  assert.throws(()=>validateCatalog({version:1,assets:[{...validAsset,localPath:'../../outside.glb'}]}),/Path escapes repository/);
  assert.throws(()=>validateCatalog({version:1,assets:[validAsset,validAsset]}),/Duplicate asset/);
});

test('candidate rankings prioritize matching name and styles', ()=>{
  assert.ok(scoreAsset({query:'wooden bar counter',style:'stylized'}, validAsset)>0);
  assert.ok(scoreAsset({query:'wooden bar counter',style:'stylized'}, validAsset)>scoreAsset({query:'spaceship',style:'realistic'}, validAsset));
});

test('catalog entries without actual GLB files yield not_found',async ()=>{
  const dir=await mkdtemp(join(tmpdir(),'hold-up-assets-'));
  try {
    const path=join(dir,'catalog.json');
    await writeFile(path,JSON.stringify({version:1,assets:[validAsset]}));
    const [result]=await resolveAssets([{id:'bar',query:'wooden bar counter',style:'stylized'}],{catalogPath:path});
    assert.equal(result.status,'not_found');
    assert.deepEqual(result.candidates,[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

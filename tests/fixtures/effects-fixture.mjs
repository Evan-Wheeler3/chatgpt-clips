import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

// A two-part test model: a "body" box and a "lever" box as separate named nodes (like the sourced nozzle)
export async function partsModel(dir) {
  const document = new Document(), buffer = document.createBuffer();
  const box = (name, [cx, cy, cz], [sx, sy, sz], color) => {
    const c = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]].map(([x, y, z]) => [cx + x * sx / 2, cy + y * sy / 2, cz + z * sz / 2]);
    const prim = document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(c.flat())).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3])).setBuffer(buffer))
      .setMaterial(document.createMaterial(name).setBaseColorFactor(color));
    return document.createNode(name).setMesh(document.createMesh(name).addPrimitive(prim));
  };
  const root = document.createNode('nozzle');
  root.addChild(box('body', [0, 0.1, 0], [0.3, 0.12, 0.1], [0.8, 0.1, 0.1, 1]));
  root.addChild(box('lever', [0, 0.02, 0], [0.22, 0.03, 0.06], [0.2, 0.2, 0.2, 1]));
  document.createScene().addChild(root);
  await mkdir(join(dir, 'assets/library'), {recursive:true});
  await writeFile(join(dir, 'assets/library/parts.glb'), await new NodeIO().writeBinary(document));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({version:1, assets:[{id:'parts', name:'Two-part test nozzle', description:'test', tags:['nozzle'], style:'stylized',
    localPath:'assets/library/parts.glb', sourceUrl:'https://example.org/parts', license:'CC0-1.0', creator:'Test'}]}));
}

export const WORDS = {words:'one two three four five six'.split(' ').map((text, i) => ({i, text, start:0.5 + i * 0.8, end:0.5 + i * 0.8 + 0.5})), audio:{durationSec:5.6}};
export const effectsStory = () => ({
  version:1, slug:'effects-test', fps:30, size:{width:1080, height:1920}, captions:false,
  narration:{script:'one two three four five six'},
  props:[{id:'nozzle', asset:{query:'nozzle'}, position:[0, 0.4, 0], grounded:false}],
  effects:[
    {id:'spill', type:'overflow', attach:{prop:'nozzle'}, params:{origin:[0.15, 0.1, 0], path:[[0.15, 0.1, 0], [0.3, -0.2, 0], [0.35, -0.4, 0]], puddle:{center:[0.4, -0.4, 0], radius:0.25}}},
    {id:'ring', type:'ring', attach:{prop:'nozzle', part:'body'}, params:{position:[0.15, 0.1, 0], radius:0.03}}
  ],
  beats:[{id:'b', purpose:'test', shots:[
    {id:'a', purpose:'grow', subject:'nozzle', camera:{move:'hold', framing:'medium', azimuth:0, elevation:5},
     events:[{effect:'spill', do:'animate', set:{progress:1}, at:'one', until:'two', ease:'linear'},
             {prop:'nozzle', do:'part', params:{part:'lever', rotation:[0, 0, -12], position:[0, -0.01, 0]}, at:'two', duration:0.4, ease:'linear'}]},
    {id:'b', purpose:'rewind', subject:'nozzle', start:'three', transition:{type:'cut', intent:'contrast', motivation:'click'}, freeze:{frames:3},
     camera:{move:'hold', framing:'medium', azimuth:0, elevation:5, shake:{at:'five', frames:3, amplitude:0.02}},
     events:[{effect:'spill', do:'animate', set:{progress:0}, at:'four', duration:0.6, ease:'expo'},
             {effect:'ring', do:'animate', set:{amount:1}, at:'four', duration:0.2},
             {prop:'nozzle', do:'material', params:{xray:1, keep:['lever'], section:{normal:[0, 0, -1], constant:0}}, at:'five', duration:0.4, ease:'linear'}]}
  ]}]
});


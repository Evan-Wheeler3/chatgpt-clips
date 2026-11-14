import { createServer } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const threeDir = resolve(root, 'node_modules/three');
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
];

export async function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const path of CHROME_PATHS) {
    try { await access(path); return path; } catch { /* Try the next location */ }
  }
  return null;
}

// Loads the GLB with the real Three.js GLTFLoader and renders four review angles into one contact sheet
const PAGE = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const MAPS = ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap'];
const VIEWS = [['three-quarter', 35, 20], ['front', 0, 5], ['side', 90, 5], ['top', 0, 85]];
window.run = async size => {
  const renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8c9196);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const gltf = await new GLTFLoader().loadAsync('/model.glb');
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const grid = new THREE.GridHelper(Math.max(1, Math.ceil(sphere.radius * 4)), Math.max(10, Math.ceil(sphere.radius * 40)), 0x444444, 0x6d7277);
  grid.position.y = box.min.y;
  scene.add(grid); // 10 cm cells give a visible scale reference

  const meshes = [], materials = new Set(), textures = [];
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    meshes.push({name:object.name, triangles:(geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3,
      attributes:Object.keys(geometry.attributes).sort()});
    for (const material of [object.material].flat()) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const slot of MAPS) if (material[slot]) {
        const image = material[slot].image;
        textures.push({material:material.name, slot, width:image?.width ?? 0, height:image?.height ?? 0, colorSpace:material[slot].colorSpace});
      }
    }
  });

  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = size * 2;
  const context = sheet.getContext('2d');
  const camera = new THREE.PerspectiveCamera(30, 1, sphere.radius / 100, sphere.radius * 100);
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.1;
  VIEWS.forEach(([label, azimuth, elevation], i) => {
    const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation);
    camera.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(distance).add(sphere.center);
    camera.lookAt(sphere.center);
    renderer.render(scene, camera);
    context.drawImage(renderer.domElement, (i % 2) * size, Math.floor(i / 2) * size);
    context.fillStyle = '#fff';
    context.font = '16px sans-serif';
    context.fillText(label, (i % 2) * size + 10, Math.floor(i / 2) * size + 24);
  });
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    png:sheet.toDataURL('image/png'),
    stats:{
      threeRevision:THREE.REVISION, webglRenderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      glError:gl.getError(), meshes, materials:materials.size, textures,
      triangles:meshes.reduce((sum, mesh) => sum + mesh.triangles, 0),
      boundsM:{min:box.min.toArray(), max:box.max.toArray()}, drawCalls:renderer.info.render.calls
    }
  };
};
window.ready = true;
</script>`;

function serve(glbPath) {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path === '/') return response.writeHead(200, {'content-type':'text/html'}).end(PAGE);
      if (path === '/favicon.ico') return response.writeHead(204).end();
      if (path === '/model.glb') {
        const body = await readFile(glbPath);
        return response.writeHead(200, {'content-type':'model/gltf-binary'}).end(body);
      }
      const file = normalize(join(threeDir, path.replace(/^\/three\//, '')));
      const allowed = [join(threeDir, 'build') + sep, join(threeDir, 'examples', 'jsm') + sep];
      if (path.startsWith('/three/') && allowed.some(dir => file.startsWith(dir)) && file.endsWith('.js')) {
        const body = await readFile(file);
        return response.writeHead(200, {'content-type':'text/javascript'}).end(body);
      }
      response.writeHead(404).end();
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

// Throws if Chrome is missing, the page logs errors, or any material texture fails to load
export async function renderPreview(glbPath, {outPath, size = 512, chromePath} = {}) {
  const executablePath = chromePath ?? await findChrome();
  if (!executablePath) throw new Error('No Chrome/Chromium found for the Three.js preview; set CHROME_PATH');
  const server = await serve(glbPath);
  // SwiftShader keeps rendering independent of the host GPU; a throwaway profile never touches the user's Chrome
  const browser = await puppeteer.launch({executablePath, headless:true, args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check']});
  try {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', message => { if (['error', 'warn'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`); });
    page.on('pageerror', err => problems.push(`pageerror: ${err.message}`));
    page.on('requestfailed', req => problems.push(`requestfailed: ${req.url()}`));
    page.on('response', res => { if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.ready === true', {timeout:30000});
    let png, stats;
    try { ({png, stats} = await page.evaluate(size => window.run(size), size)); }
    catch (err) { throw new Error(`Three.js preview failed: ${[err.message.split('\n')[0], ...problems].join('; ')}`); }
    const missing = stats.textures.filter(texture => !texture.width || !texture.height);
    const errors = problems.filter(problem => !problem.startsWith('warn:'));
    if (missing.length) errors.push(`Textures failed to load in Three.js: ${missing.map(t => `${t.material}.${t.slot}`).join(', ')}`);
    if (!stats.meshes.length) errors.push('Three.js loaded no meshes');
    if (stats.glError) errors.push(`WebGL error ${stats.glError}`);
    if (errors.length) throw new Error(`Three.js preview failed: ${errors.join('; ')}`);
    if (outPath) await writeFile(outPath, Buffer.from(png.split(',')[1], 'base64'));
    return {...stats, chrome:await browser.version(), consoleWarnings:problems.filter(problem => problem.startsWith('warn:'))};
  } finally {
    await browser.close();
    await new Promise(done => server.close(done));
  }
}

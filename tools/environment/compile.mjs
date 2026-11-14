import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3, Quaternion, Euler, Box3, MathUtils } from 'three';
import { validateCatalog } from '../asset-resolver.mjs';
import { loadTextureCatalog } from '../materials/textures.mjs';
import { cachedShape } from '../storyboard/shape.mjs';
export { cachedShape };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Bump when the compiled environment format or expansion rules change, so cached builds are rebuilt
export const ENVIRONMENT_VERSION = 1;
const ARCHITECTURE_TYPES = new Set(['floor', 'walls', 'plinth', 'piers', 'trusses', 'roof', 'rack']);
const LAYERS = new Set(['foreground', 'midground', 'background']);
const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function loadStyle(id = 'hold-up', overrides = {}) {
  const base = JSON.parse(await readFile(resolve(root, 'styles', `${id}.json`), 'utf8'));
  return {...base, palette:{...base.palette, ...(overrides.palette ?? {})}, grade:{...base.grade, ...(overrides.grade ?? {}), bloom:{...base.grade.bloom, ...(overrides.grade?.bloom ?? {})}},
    materials:Object.fromEntries(Object.entries(base.materials).map(([role, m]) => [role, {...m, ...(overrides.materials?.[role] ?? {})}])), character:{...base.character, ...(overrides.character ?? {})}};
}

const color = (palette, value) => typeof value === 'string' && palette[value] ? palette[value] : value;
const quat = degrees => new Quaternion().setFromEuler(new Euler(...degrees.map(MathUtils.degToRad), 'XYZ'));

function worldBox(shape, position, rotation, scale = 1) {
  const q = quat(rotation);
  return new Box3().setFromPoints(shape.points.map(p => new Vector3(...p).multiplyScalar(scale).applyQuaternion(q).add(new Vector3(...position))));
}

// Lays barrels on their side along a rack, two tiers nested in the valleys, skipping gaps for doors and piers
function expandRack(rack, shape) {
  const [x0, z0] = rack.from, [x1, z1] = rack.to;
  const along = new Vector3(x1 - x0, 0, z1 - z0);
  const length = along.length();
  along.normalize();
  const lying = rack.axis === 'x' ? [0, 0, 90] : [90, 0, 0];
  const restBox = worldBox(shape, [0, 0, 0], lying);
  const radius = (restBox.max.y - restBox.min.y) / 2;
  const rail = 0.22;
  const items = [];
  const {spacing, tiers = 1, skip = []} = rack.load;
  for (let tier = 0; tier < tiers; tier++) {
    const offset = tier * spacing / 2;
    for (let s = spacing / 2 + offset; s <= length - spacing / 2; s += spacing) {
      const at = new Vector3(x0, 0, z0).addScaledVector(along, s);
      const coord = Math.abs(along.x) > Math.abs(along.z) ? at.x : at.z;
      if (skip.some(k => Math.abs(k - coord) < spacing * 0.6)) continue;
      const spin = (items.length * 47) % 360; // Vary bung positions so the rows do not look cloned
      const rotation = lying.map((v, i) => i === (rack.axis === 'x' ? 0 : 2) ? spin : v);
      // Rest height from the spun silhouette, so non-round stock still sits on the rails rather than in them
      const y = rail - worldBox(shape, [0, 0, 0], rotation).min.y + tier * radius * 1.72;
      items.push({position:[at.x, y, at.z], rotation});
    }
  }
  return items;
}

// Collision/occlusion boxes for procedural architecture, used by validation (walls are handled as room bounds)
function architectureBoxes(env) {
  const boxes = [];
  const [minX, , minZ] = env.bounds.min, [maxX, , maxZ] = env.bounds.max;
  for (const part of env.architecture) {
    if (part.type === 'piers') for (const p of part.positions) {
      const w = part.width / 2, d = part.depth;
      const box = part.side === 'left' ? [[minX, 0, p - w], [minX + d, env.bounds.max[1], p + w]]
        : part.side === 'right' ? [[maxX - d, 0, p - w], [maxX, env.bounds.max[1], p + w]]
        : part.side === 'back' ? [[p - w, 0, minZ], [p + w, env.bounds.max[1], minZ + d]] : [[p - w, 0, maxZ - d], [p + w, env.bounds.max[1], maxZ]];
      boxes.push({id:`pier:${part.side}:${p}`, kind:'architecture', min:box[0], max:box[1]});
    }
    if (part.type === 'trusses') for (const z of part.z) boxes.push({id:`tie-beam:${z}`, kind:'architecture', min:[minX, part.tieHeight - 0.02, z - part.beam[0] / 2], max:[maxX, part.tieHeight + part.beam[1], z + part.beam[0] / 2]});
    if (part.type === 'rack') {
      const [x0, z0] = part.from, [x1, z1] = part.to;
      boxes.push({id:`rack:${x0},${z0}`, kind:'architecture', min:[Math.min(x0, x1) - 0.45, 0, Math.min(z0, z1) - 0.45], max:[Math.max(x0, x1) + 0.45, 0.24, Math.max(z0, z1) + 0.45]});
    }
  }
  return boxes;
}

export async function compileEnvironment(id, {style, catalogPath = resolve(root, 'assets/catalog.json'), textureCatalogPath, rootDir = root, cacheDir = resolve(root, '.cache/environments')} = {}) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid environment id: ${id}`);
  const specBytes = await readFile(resolve(rootDir, 'environments', `${id}.json`));
  const env = JSON.parse(specBytes);
  if (env.version !== 1 || env.id !== id) throw new Error(`Environment ${id}: bad version or id`);
  for (const part of env.architecture) if (!ARCHITECTURE_TYPES.has(part.type)) throw new Error(`Environment ${id}: unknown architecture type "${part.type}"`);
  for (const item of env.dressing) if (!LAYERS.has(item.layer)) throw new Error(`Environment ${id}: dressing layer must be foreground, midground or background`);

  const catalog = validateCatalog(JSON.parse(await readFile(catalogPath, 'utf8')), rootDir);
  const textures = await loadTextureCatalog(textureCatalogPath, rootDir);
  const key = sha256(JSON.stringify({v:ENVIRONMENT_VERSION, spec:sha256(specBytes), style:style?.palette ?? null,
    assets:catalog.assets.map(a => [a.id, a.sha256]), textures:textures.textures.map(t => [t.id, t.maps.color.sha256])})).slice(0, 16);
  const cacheFile = join(cacheDir, `${id}-${key}.json`);
  try { return {...JSON.parse(await readFile(cacheFile, 'utf8')), cache:'hit'}; } catch { /* Build below */ }

  const missing = [];
  const materials = {};
  for (const [name, m] of Object.entries(env.materials)) {
    const entry = m.texture ? textures.textures.find(t => t.id === m.texture) : null;
    const files = entry ? await Promise.all(Object.values(entry.maps).map(map => readFile(resolve(rootDir, map.localPath)).then(() => true, () => false))) : [];
    if (m.texture && (!entry || files.includes(false))) missing.push({kind:'texture', id:m.texture, material:name});
    materials[name] = {
      role:m.role ?? 'architecture', tint:color(style?.palette ?? {}, m.tint) ?? '#ffffff', color:m.color ?? null, roughness:m.roughness ?? null, metalness:m.metalness ?? null,
      texture:entry && !files.includes(false) ? {id:entry.id, realSizeM:entry.realSizeM, maps:Object.fromEntries(Object.entries(entry.maps).map(([role, map]) => [role, map.localPath])),
        license:entry.license, creator:entry.creator, sourceUrl:entry.sourceUrl} : null
    };
  }

  const assets = {};
  async function asset(assetId) {
    if (assetId in assets) return assets[assetId];
    const entry = catalog.assets.find(a => a.id === assetId);
    let present = false;
    if (entry) present = await readFile(resolve(rootDir, entry.localPath)).then(() => true, () => false);
    if (!entry || !present) { missing.push({kind:'model', id:assetId}); return assets[assetId] = null; }
    const shape = await cachedShape(resolve(rootDir, entry.localPath), entry.sha256);
    return assets[assetId] = {id:entry.id, name:entry.name, localPath:entry.localPath, sha256:entry.sha256 ?? null, triangles:entry.triangles ?? 0,
      license:entry.license, creator:entry.creator, sourceUrl:entry.sourceUrl, bounds:{min:shape.min, max:shape.max}, points:shape.points};
  }

  // Every placed model instance, with a world box for validation (racks expand into many instances)
  const instances = [];
  for (const part of env.architecture.filter(p => p.type === 'rack')) {
    const a = await asset(part.load.asset);
    if (!a) continue;
    // Racked stock sits against the walls: no outline and no shadow casting, which halves its cost
    for (const item of expandRack(part, a)) instances.push({asset:a.id, layer:'background', source:'rack', castShadow:false, ...item});
  }
  for (const item of env.dressing) {
    const a = await asset(item.asset);
    if (a) instances.push({asset:a.id, layer:item.layer, source:'dressing', position:item.position, rotation:item.rotation ?? [0, 0, 0], scale:item.scale ?? 1});
  }
  for (const [i, light] of env.lighting.practicals.entries()) {
    if (!light.hang) continue;
    const a = await asset(light.hang.asset);
    if (a) instances.push({asset:a.id, layer:'midground', source:`practical:${i}`, position:[light.position[0], light.position[1] - 0.42, light.position[2]], rotation:[0, 20 * i, 0], scale:1});
  }
  for (const instance of instances) {
    const box = worldBox(assets[instance.asset], instance.position, instance.rotation, instance.scale ?? 1);
    instance.box = {min:box.min.toArray(), max:box.max.toArray()};
  }

  // Dressing must stay out of the story action area
  const intrusions = instances.filter(instance => env.keepClear.some(zone => {
    const c = new Vector3(...zone.center), box = new Box3(new Vector3(...instance.box.min), new Vector3(...instance.box.max));
    return box.distanceToPoint(c.setY(Math.min(Math.max(c.y, box.min.y), box.max.y))) < zone.radius;
  })).map(instance => ({asset:instance.asset, position:instance.position}));

  const unique = Object.values(assets).filter(Boolean);
  const budget = {
    triangles:instances.reduce((sum, i) => sum + assets[i.asset].triangles, 0) + 20_000,
    // Identical models are instanced: draw calls scale with unique assets, not instance count
    drawCalls:unique.length * 3 + env.architecture.length * 4 + env.lighting.practicals.length * 2,
    textureMB:Math.round((unique.length * 3 + Object.values(materials).filter(m => m.texture).length * 3) * 1024 * 1024 * 4 * 1.33 / (1024 * 1024))
  };

  const palette = style?.palette ?? {};
  const compiled = {
    version:ENVIRONMENT_VERSION, id, key, name:env.name, period:env.period, location:env.location, bounds:env.bounds, keepClear:env.keepClear,
    materials, architecture:env.architecture, assets:Object.fromEntries(unique.map(a => [a.id, a])), instances,
    boxes:architectureBoxes(env), budget, missing, intrusions,
    lighting:{
      ...env.lighting,
      key:{...env.lighting.key, color:color(palette, env.lighting.key.color)},
      fill:env.lighting.fill && {...env.lighting.fill, color:color(palette, env.lighting.fill.color)},
      ambient:{...env.lighting.ambient, sky:color(palette, env.lighting.ambient.sky), ground:color(palette, env.lighting.ambient.ground)}
    },
    atmosphere:{...env.atmosphere, fog:env.atmosphere.fog && {...env.atmosphere.fog, color:color(palette, env.atmosphere.fog.color)}},
    sources:{spec:sha256(specBytes)}
  };
  await mkdir(cacheDir, {recursive:true});
  await writeFile(cacheFile, JSON.stringify(compiled));
  return {...compiled, cache:'miss'};
}

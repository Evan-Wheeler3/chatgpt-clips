"""Convert a ModernGL-style vertex dump (.npz of float32 arrays) into flat binaries the episode renderer can load.

Layouts supported:
  12 floats per vertex: position(3) normal(3) uv(2) colour(3) kind(1)   (procedural props, vertex-coloured)
   8 floats per vertex: position(3) normal(3) uv(2)                      (pre-lit mesh with a baked atlas)
Source is Z-up; output is Y-up (x, z, -y). Writes <name>.bin (float32, same layout) and manifest.json.
  python -I tools/episode/import_npz_meshes.py <file.npz> [<file.npz> ...] --out production/<slug>/assets
"""
import sys, json
from pathlib import Path
import numpy as np

args = sys.argv[1:]; out = Path(args[args.index('--out') + 1]); files = [a for a in args if a.endswith('.npz')]
out.mkdir(parents=True, exist_ok=True)
man = {}
for f in files:
    z = np.load(f, allow_pickle=False)
    for k in z.files:
        v = z[k].astype('f4').copy()
        if v.ndim != 2 or v.shape[1] not in (8, 12): continue
        for o in (0, 3):  # position and normal: Z-up -> Y-up
            x, y, zz = v[:, o].copy(), v[:, o + 1].copy(), v[:, o + 2].copy()
            v[:, o], v[:, o + 1], v[:, o + 2] = x, zz, -y
        name = k[:-4] if k.endswith('.npy') else k
        v.tofile(out / f'{name}.bin')
        man[name] = {'stride': int(v.shape[1]), 'vertices': int(v.shape[0]), 'source': Path(f).name,
                     'min': np.round(v[:, :3].min(0), 3).tolist(), 'max': np.round(v[:, :3].max(0), 3).tolist()}
        print(name, v.shape, man[name]['min'], man[name]['max'])
(out / 'manifest.json').write_text(json.dumps(man, indent=1))

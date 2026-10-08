// Procedural textures generated at startup: a tileable multi-channel noise
// texture (detail, clouds, cloud shadows) and an atlas of foliage cards.

import { mulberry32 } from '../core/noise.js';

function periodicValueNoise(size, period, seed) {
  const rnd = mulberry32(seed);
  const lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  const s = period / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * s, fy = y * s;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
      ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const x0 = ix % period, y0 = iy % period, x1 = (ix + 1) % period, y1 = (iy + 1) % period;
      const a = lat[y0 * period + x0], b = lat[y0 * period + x1], c = lat[y1 * period + x0], d = lat[y1 * period + x1];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function periodicFbm(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const p = basePeriod << o;
    if (p > size) break;
    const n = periodicValueNoise(size, p, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function periodicWorley(size, cells, seed) {
  const rnd = mulberry32(seed);
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + rnd()) / cells, (j + rnd()) / cells]);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let best = 1e9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
        const p = pts[jj * cells + ii];
        let dx = p[0] - u, dy = p[1] - v;
        dx -= Math.round(dx); dy -= Math.round(dy);
        best = Math.min(best, dx * dx + dy * dy);
      }
      out[y * size + x] = Math.min(1, Math.sqrt(best) * cells * 0.9);
    }
  }
  return out;
}

export function createNoiseTexture(gl, size = 256) {
  const r = periodicFbm(size, 4, 6, 11);
  const g = periodicWorley(size, 12, 22);
  const b = periodicFbm(size, 32, 3, 33);
  const a = periodicFbm(size, 8, 5, 44);
  const data = new Uint8Array(size * size * 4);
  // stretch contrast: fbm averages cluster around 0.5
  const st = (v) => Math.max(0, Math.min(255, Math.round(((v - 0.5) * 1.8 + 0.5) * 255)));
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = st(r[i]); data[i * 4 + 1] = Math.round(g[i] * 255); data[i * 4 + 2] = st(b[i]); data[i * 4 + 3] = st(a[i]);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return tex;
}

// Ground material texture array (4 layers, 512², RGB = albedo detail around
// mid-grey, A = height): 0 sand, 1 layered rock, 2 soil & grass, 3 gravel.
function periodicWorley2(size, cells, seed) {
  const rnd = mulberry32(seed);
  const pts = [], val = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) { pts.push([(i + rnd()) / cells, (j + rnd()) / cells]); val.push(rnd()); }
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size), id = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const ci = Math.floor(u * cells), cj = Math.floor(v * cells);
      let b1 = 1e9, b2 = 1e9, bi = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + cells) % cells, jj = (cj + dj + cells) % cells;
        const p = pts[jj * cells + ii];
        let dx = p[0] - u, dy = p[1] - v;
        dx -= Math.round(dx); dy -= Math.round(dy);
        const d = dx * dx + dy * dy;
        if (d < b1) { b2 = b1; b1 = d; bi = jj * cells + ii; } else if (d < b2) b2 = d;
      }
      const k = y * size + x;
      f1[k] = Math.sqrt(b1) * cells; f2[k] = Math.sqrt(b2) * cells; id[k] = val[bi];
    }
  }
  return { f1, f2, id };
}

export function createGroundTextures(gl, size = 512) {
  const N = size * size;
  const layers = [];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // 0 sand: soft grain, faint mottling
  {
    const a = periodicFbm(size, 8, 5, 101), g = periodicValueNoise(size, 256, 102), g2 = periodicValueNoise(size, 128, 103);
    const rgb = new Float32Array(N), h = new Float32Array(N);
    for (let i = 0; i < N; i++) { rgb[i] = 0.5 + (a[i] - 0.5) * 0.25 + (g[i] - 0.5) * 0.18 + (g2[i] - 0.5) * 0.08; h[i] = a[i] * 0.4 + g[i] * 0.6; }
    layers.push({ rgb, h, tint: [1, 0.99, 0.97] });
  }
  // 1 rock: sedimentary bands, cracks between blocks, lichen-ish blotches
  {
    const w = periodicWorley2(size, 7, 201), n = periodicFbm(size, 4, 6, 202), fine = periodicFbm(size, 32, 3, 203);
    const bandsRaw = periodicFbm(size, 2, 4, 204);
    const rgb = new Float32Array(N), h = new Float32Array(N);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const crack = 1 - Math.min(1, (w.f2[i] - w.f1[i]) * 9);
      const band = Math.sin((y / size) * Math.PI * 2 * 9 + bandsRaw[i] * 6) * 0.5 + 0.5;
      const v = 0.5 + (n[i] - 0.5) * 0.45 + (band - 0.5) * 0.18 + (fine[i] - 0.5) * 0.2 + (w.id[i] - 0.5) * 0.18 - crack * 0.35;
      rgb[i] = v; h[i] = clamp01(0.55 + (n[i] - 0.5) * 0.6 + (w.id[i] - 0.5) * 0.3 - crack * 0.5);
    }
    layers.push({ rgb, h, tint: [1, 0.98, 0.95] });
  }
  // 2 soil & grass: earthy blotches with tufts and twigs
  {
    const n = periodicFbm(size, 8, 5, 301), f = periodicFbm(size, 64, 2, 302), w = periodicWorley2(size, 40, 303);
    const rgb = new Float32Array(N), h = new Float32Array(N);
    const R = mulberry32(304);
    for (let i = 0; i < N; i++) {
      rgb[i] = 0.5 + (n[i] - 0.5) * 0.4 + (f[i] - 0.5) * 0.25 - Math.max(0, 0.25 - w.f1[i]) * 0.6;
      h[i] = n[i] * 0.5 + f[i] * 0.5;
    }
    // blades
    for (let b = 0; b < 9000; b++) {
      const x0 = R() * size, y0 = R() * size, a = R() * Math.PI * 2, len = 3 + R() * 7, v = 0.55 + R() * 0.35;
      for (let t = 0; t < len; t++) {
        const x = Math.floor(x0 + Math.cos(a) * t + size) % size, y = Math.floor(y0 + Math.sin(a) * t + size) % size;
        rgb[y * size + x] = v; h[y * size + x] = 0.7;
      }
    }
    layers.push({ rgb, h, tint: [1, 1.02, 0.96] });
  }
  // 3 gravel: rounded pebbles of varied tone, packed fines between
  {
    const w = periodicWorley2(size, 26, 401), w2 = periodicWorley2(size, 60, 402), n = periodicFbm(size, 16, 3, 403);
    const rgb = new Float32Array(N), h = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const dome = clamp01(1 - w.f1[i] * 1.6);
      const dome2 = clamp01(1 - w2.f1[i] * 1.7);
      const big = dome > 0.05;
      const tone = big ? 0.3 + w.id[i] * 0.55 : 0.4 + w2.id[i] * 0.3;
      rgb[i] = tone * (0.75 + 0.35 * (big ? dome : dome2)) + (n[i] - 0.5) * 0.12;
      h[i] = big ? 0.4 + dome * 0.6 : dome2 * 0.4;
    }
    layers.push({ rgb, h, tint: [1, 0.98, 0.96] });
  }
  const data = new Uint8Array(N * 4 * layers.length);
  layers.forEach((L, li) => {
    for (let i = 0; i < N; i++) {
      const o = (li * N + i) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(clamp01(L.rgb[i] * L.tint[c]) * 255);
      data[o + 3] = Math.round(clamp01(L.h[i]) * 255);
    }
  });
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  if (ext) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return tex;
}

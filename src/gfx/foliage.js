// Procedural foliage atlas (1024x512, 4x2 tiles of 256²) drawn with Canvas2D.
// Tiles are near-neutral in hue; species colour comes from vertex colour.
//  0 needle spray (cedar)   1 broadleaf cluster   2 palm frond   3 grass tuft
//  4 acacia leaflets        5 tamarisk sprays     6 straw grass  7 juniper scales

import { mulberry32 } from '../core/noise.js';

export const TILE = { NEEDLE: 0, LEAF: 1, FROND: 2, GRASS: 3, ACACIA: 4, TAMARISK: 5, STRAW: 6, SCALE: 7 };

function g(v, a = 1) { const c = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgba(${c},${c},${c},${a})`; }
function rgb(r, gg, b, a = 1) { return `rgba(${Math.round(r * 255)},${Math.round(gg * 255)},${Math.round(b * 255)},${a})`; }

function drawNeedles(ctx, R) {
  // flat sprays of short needles along branchlets, layered like cedar tiers
  for (let s = 0; s < 7; s++) {
    const x0 = 128 + (R() - 0.5) * 120, y0 = 128 + (R() - 0.5) * 120;
    const ang = R() * Math.PI * 2, len = 60 + R() * 50;
    ctx.strokeStyle = rgb(0.35, 0.3, 0.25); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len); ctx.stroke();
    for (let t = 0; t < 1; t += 0.035) {
      const x = x0 + Math.cos(ang) * len * t, y = y0 + Math.sin(ang) * len * t;
      for (let k = 0; k < 9; k++) {
        const a = R() * Math.PI * 2, l = 5 + R() * 8;
        ctx.strokeStyle = g(0.55 + R() * 0.45); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    }
  }
}

function leafShape(ctx, x, y, a, len, w, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -w, len, 0);
  ctx.quadraticCurveTo(len * 0.5, w, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,40,30,0.35)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.9, 0); ctx.stroke();
  ctx.restore();
}

function drawLeaves(ctx, R) {
  ctx.strokeStyle = rgb(0.35, 0.28, 0.2); ctx.lineWidth = 3;
  for (let b = 0; b < 4; b++) {
    ctx.beginPath(); ctx.moveTo(128, 250); ctx.quadraticCurveTo(128 + (R() - 0.5) * 120, 150, 40 + R() * 176, 30 + R() * 80); ctx.stroke();
  }
  for (let i = 0; i < 120; i++) {
    const r = Math.sqrt(R()) * 110;
    const a = R() * Math.PI * 2;
    const x = 128 + Math.cos(a) * r, y = 120 + Math.sin(a) * r * 0.9;
    const v = 0.5 + R() * 0.5;
    leafShape(ctx, x, y, R() * Math.PI * 2, 18 + R() * 12, 6 + R() * 3, g(v));
  }
}

function drawFrond(ctx, R) {
  // rachis along the tile's vertical centre; leaflets angled toward the tip
  ctx.strokeStyle = g(0.75); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(128, 256); ctx.quadraticCurveTo(122, 128, 128, 4); ctx.stroke();
  for (let t = 0.04; t < 0.98; t += 0.022) {
    const y = 256 - t * 252;
    const len = 110 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (0.85 + R() * 0.25) + 10;
    for (const s of [-1, 1]) {
      const a = s * (0.55 + R() * 0.2);
      ctx.strokeStyle = g(0.55 + R() * 0.4); ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(128, y);
      ctx.quadraticCurveTo(128 + s * len * 0.5, y - len * 0.25, 128 + Math.sin(a) * len, y - Math.cos(a) * len * 0.55);
      ctx.stroke();
    }
  }
}

function drawGrass(ctx, R, dry) {
  for (let i = 0; i < (dry ? 70 : 110); i++) {
    const x0 = 128 + (R() - 0.5) * 60;
    const h = 120 + R() * 130;
    const bend = (R() - 0.5) * 140;
    const v = dry ? 0.65 + R() * 0.35 : 0.45 + R() * 0.55;
    ctx.strokeStyle = g(v); ctx.lineWidth = dry ? 2 : 2.4;
    ctx.beginPath(); ctx.moveTo(x0, 256);
    ctx.quadraticCurveTo(x0 + bend * 0.3, 256 - h * 0.6, x0 + bend, 256 - h);
    ctx.stroke();
  }
  if (dry) {
    // seed heads
    for (let i = 0; i < 18; i++) {
      const x = 128 + (R() - 0.5) * 200, y = 20 + R() * 80;
      ctx.fillStyle = g(0.9); ctx.fillRect(x, y, 2, 14);
    }
  }
}

function drawAcacia(ctx, R) {
  ctx.strokeStyle = rgb(0.4, 0.35, 0.3); ctx.lineWidth = 2;
  for (let b = 0; b < 8; b++) {
    const a = R() * Math.PI * 2;
    const x1 = 128 + Math.cos(a) * 110, y1 = 128 + Math.sin(a) * 60;
    ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(x1, y1); ctx.stroke();
    for (let t = 0.2; t < 1; t += 0.08) {
      const x = 128 + (x1 - 128) * t, y = 128 + (y1 - 128) * t;
      for (let k = 0; k < 10; k++) {
        ctx.fillStyle = g(0.55 + R() * 0.45);
        ctx.beginPath(); ctx.arc(x + (R() - 0.5) * 22, y + (R() - 0.5) * 14, 1.6 + R() * 1.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

function drawTamarisk(ctx, R) {
  for (let s = 0; s < 40; s++) {
    const x0 = 128 + (R() - 0.5) * 180, y0 = 30 + R() * 200;
    const a = -Math.PI / 2 + (R() - 0.5) * 1.2, l = 30 + R() * 50;
    ctx.strokeStyle = g(0.6 + R() * 0.4); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + Math.cos(a) * l * 0.5 + 8, y0 + Math.sin(a) * l * 0.5, x0 + Math.cos(a) * l, y0 + Math.sin(a) * l);
    ctx.stroke();
    for (let k = 0; k < 10; k++) {
      ctx.fillStyle = g(0.65 + R() * 0.35);
      ctx.fillRect(x0 + Math.cos(a) * l * k / 10 + (R() - 0.5) * 6, y0 + Math.sin(a) * l * k / 10, 2, 2);
    }
  }
}

function drawScales(ctx, R) {
  for (let i = 0; i < 260; i++) {
    const r = Math.sqrt(R()) * 115, a = R() * Math.PI * 2;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    ctx.fillStyle = g(0.45 + R() * 0.55);
    ctx.beginPath(); ctx.ellipse(x, y, 4 + R() * 6, 3 + R() * 3, R() * 3, 0, Math.PI * 2); ctx.fill();
  }
}

export function createFoliageAtlas(gl) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 512);
  const draws = [drawNeedles, drawLeaves, drawFrond, (x, R) => drawGrass(x, R, false), drawAcacia, drawTamarisk, (x, R) => drawGrass(x, R, true), drawScales];
  draws.forEach((fn, i) => {
    const R = mulberry32(100 + i * 17);
    ctx.save();
    // canvas y runs down; tile v=0 is the top row of the atlas texture
    ctx.translate((i % 4) * 256, Math.floor(i / 4) * 256);
    ctx.beginPath(); ctx.rect(0, 0, 256, 256); ctx.clip();
    fn(ctx, R);
    ctx.restore();
  });
  // dilate colour into transparent texels so mip-mapping doesn't bleed black
  const img = ctx.getImageData(0, 0, 1024, 512);
  const d = img.data;
  for (let pass = 0; pass < 4; pass++) {
    const src = new Uint8ClampedArray(d);
    for (let y = 1; y < 511; y++) {
      for (let x = 1; x < 1023; x++) {
        const i = (y * 1024 + x) * 4;
        if (src[i + 3] > 0) continue;
        let r = 0, gg = 0, b = 0, n = 0;
        for (const o of [-4, 4, -4096, 4096]) {
          if (src[i + o + 3] > 0 || (src[i + o] + src[i + o + 1] + src[i + o + 2]) > 0) { r += src[i + o]; gg += src[i + o + 1]; b += src[i + o + 2]; n++; }
        }
        if (n) { d[i] = r / n; d[i + 1] = gg / n; d[i + 2] = b / n; }
      }
    }
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

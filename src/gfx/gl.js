// Thin WebGL2 helpers: program compilation with #defines, buffers, VAOs.

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  return gl;
}

function compile(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const lines = src.split('\n').map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n');
    console.error(`Shader compile error in ${name}:\n${log}\n${lines}`);
    throw new Error(`Shader compile error in ${name}: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vs, fs, defines = {}, name = 'program') {
    this.gl = gl;
    const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\nprecision highp sampler2DArray;\n' +
      Object.entries(defines).filter(([, v]) => v !== false).map(([k, v]) => `#define ${k} ${v === true ? '' : v}`).join('\n') + '\n';
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, head + vs, name + '.vs'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, head + fs, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link error in ${name}: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    this.uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const nm = info.name.replace(/\[0\]$/, '');
      this.uniforms[nm] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    this.textureUnits = {};
    let unit = 0;
    for (const [nm, u] of Object.entries(this.uniforms)) {
      if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_2D_SHADOW || u.type === gl.SAMPLER_2D_ARRAY || u.type === gl.SAMPLER_2D_ARRAY_SHADOW) {
        this.textureUnits[nm] = unit++;
      }
    }
  }

  use() {
    const gl = this.gl;
    gl.useProgram(this.prog);
    for (const [nm, unit] of Object.entries(this.textureUnits)) gl.uniform1i(this.uniforms[nm].loc, unit);
    return this;
  }

  has(name) { return !!this.uniforms[name]; }

  set(name, v) {
    const u = this.uniforms[name];
    if (!u) return this;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT: if (u.size > 1) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, v); break;
      default: break;
    }
    return this;
  }

  tex(name, texture, target) {
    const unit = this.textureUnits[name];
    if (unit === undefined) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target ?? gl.TEXTURE_2D, texture);
    return this;
  }
}

export function makeBuffer(gl, data, usage, target) {
  const b = gl.createBuffer();
  gl.bindBuffer(target ?? gl.ARRAY_BUFFER, b);
  gl.bufferData(target ?? gl.ARRAY_BUFFER, data, usage ?? gl.STATIC_DRAW);
  return b;
}

// attribs: [{loc, buffer, size, type?, normalized?, stride?, offset?, divisor?}]
export function makeVAO(gl, attribs, indexBuffer = null) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const a of attribs) {
    if (!a.buffer) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
    gl.enableVertexAttribArray(a.loc);
    const type = a.type ?? gl.FLOAT;
    if (a.integer) gl.vertexAttribIPointer(a.loc, a.size, type, a.stride ?? 0, a.offset ?? 0);
    else gl.vertexAttribPointer(a.loc, a.size, type, a.normalized ?? false, a.stride ?? 0, a.offset ?? 0);
    if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
  }
  if (indexBuffer) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bindVertexArray(null);
  return vao;
}

// Fixed attribute locations shared by every program (bound before linking is
// not available with our Program helper, so we use layout qualifiers in GLSL).
export const LOC = {
  POS: 0, NRM: 1, COL: 2, LIMB: 3, DETAIL: 4,
  I0: 5, I1: 6, I2: 7, I3: 8,
};

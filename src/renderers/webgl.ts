import { FRAME_STRIDE, MAX_GLYPHS, type RenderFrame } from '../engine/compositor';
import { atlasIndex, ATLAS_COLS, createAtlas, TILE_H, TILE_W } from './atlas';

const vertex = '#version 300 es\n' + [
  'precision highp float;',
  'layout(location=0) in vec4 rect;',
  'layout(location=1) in float glyph;',
  'layout(location=2) in vec4 color;',
  'layout(location=3) in float solid;',
  'uniform vec2 resolution;',
  'uniform vec2 atlasSize;',
  'out vec2 uv; out vec4 tint; out float opaque;',
  'const vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));',
  'void main(){',
  'vec2 p=corners[gl_VertexID];',
  'vec2 pixel=rect.xy+p*rect.zw;',
  'gl_Position=vec4(pixel/resolution*vec2(2,-2)+vec2(-1,1),0,1);',
  'vec2 tile=vec2(mod(glyph,16.0),floor(glyph/16.0))*vec2(32,48);',
  'uv=(tile+p*vec2(32,48))/atlasSize;',
  'tint=color; opaque=solid;',
  '}',
].join('\n');
const fragment = '#version 300 es\n' + [
  'precision highp float;',
  'uniform sampler2D atlas; uniform vec3 background;',
  'in vec2 uv; in vec4 tint; in float opaque; out vec4 result;',
  'void main(){ float mask=texture(atlas,uv).a;',
  'result=vec4(mix(background,tint.rgb,mask),mix(mask,1.0,opaque)*tint.a); }',
].join('\n');

export class WebGLRenderer {
  readonly backend = 'WebGL2';
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private upload = new Float32Array(MAX_GLYPHS * FRAME_STRIDE);
  private atlasHeight: number;
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Не удалось создать шейдер');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Ошибка шейдера: ' + gl.getShaderInfoLog(shader));
      return shader;
    };
    this.program = gl.createProgram()!;
    try {
      gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Ошибка программы WebGL: ' + gl.getProgramInfoLog(this.program));
    } catch (error) { gl.deleteProgram(this.program); throw error; }
    finally { shaders.forEach(shader => gl.deleteShader(shader)); }
    const atlas = createAtlas(); this.atlasHeight = atlas.height;
    this.texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.buffer = gl.createBuffer()!; this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.upload.byteLength, gl.DYNAMIC_DRAW);
    for (let loc = 0; loc < 4; loc++) { gl.enableVertexAttribArray(loc); gl.vertexAttribDivisor(loc, 1); }
    gl.enable(gl.BLEND);
  }
  render(frame: RenderFrame): number {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...frame.background, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const data = frame.data.subarray(0, frame.count * FRAME_STRIDE);
    this.upload.set(data);
    for (let i = 0; i < frame.count; i++) this.upload[i * FRAME_STRIDE + 4] = atlasIndex.get(data[i * FRAME_STRIDE + 4]) ?? 1;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.upload.subarray(0, data.length));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'atlas'), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'resolution'), frame.width, frame.height);
    gl.uniform2f(gl.getUniformLocation(this.program, 'atlasSize'), ATLAS_COLS * TILE_W, this.atlasHeight);
    gl.uniform3f(gl.getUniformLocation(this.program, 'background'), ...frame.background);
    let calls = 0;
    for (const batch of frame.batches) {
      if (!batch.count) continue;
      gl.blendFunc(gl.SRC_ALPHA, batch.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      const offset = batch.start * FRAME_STRIDE * 4;
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 40, offset);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 40, offset + 16);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, offset + 20);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, offset + 36);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count); calls++;
    }
    return calls;
  }
  dispose() {
    this.gl.deleteBuffer(this.buffer); this.gl.deleteTexture(this.texture);
    this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program);
  }
}

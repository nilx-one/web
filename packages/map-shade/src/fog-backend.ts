// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { ATLAS_GLSL, ATLAS_WGSL, FOG_PARAMETER_VECTORS } from "./fog-material";

export interface FogBackend {
  readonly kind: "webgpu" | "webgl2";
  readonly canvas: HTMLCanvasElement;
  /**
   * Draws one frame and hands the backend canvas to `present` in the same
   * task the frame was drawn in. A WebGPU canvas holds its frame only until
   * the task ends: read after an await, it is presented and may read back
   * empty (iOS Safari does), which drops the whole fog for that frame.
   */
  render(
    mask: HTMLCanvasElement,
    parameters: Float32Array<ArrayBuffer>,
    maskChanged: boolean,
    present: (frame: HTMLCanvasElement) => void,
  ): Promise<void>;
  dispose(): void;
}

export async function createWebGpuFog(
  size: number,
  lost: () => void,
  document: Document = globalThis.document,
): Promise<FogBackend> {
  const gpu = globalThis.navigator?.gpu;
  if (gpu === undefined) throw new Error("WebGPU unavailable");
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error("WebGPU adapter unavailable");
  const device = await adapter.requestDevice();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  let disposed = false;
  let failed = false;
  const fail = () => {
    failed = true;
    if (!disposed) lost();
  };
  void device.lost.then(fail);
  device.addEventListener("uncapturederror", fail);
  try {
    const context = canvas.getContext("webgpu");
    if (context === null) throw new Error("WebGPU canvas unavailable");
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const module = device.createShaderModule({ code: ATLAS_WGSL });
    const pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vertex" },
      fragment: { module, entryPoint: "fragment", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    const maskTexture = device.createTexture({
      size: [size, size],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const buffer = device.createBuffer({
      size: FOG_PARAMETER_VECTORS * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: maskTexture.createView() },
        {
          binding: 1,
          resource: device.createSampler({
            magFilter: "nearest",
            minFilter: "nearest",
          }),
        },
        { binding: 2, resource: { buffer } },
      ],
    });
    return {
      kind: "webgpu",
      canvas,
      async render(mask, parameters, maskChanged, present) {
        if (disposed || failed) throw new Error("Fog GPU device lost");
        if (maskChanged)
          device.queue.copyExternalImageToTexture(
            { source: mask },
            { texture: maskTexture },
            [size, size],
          );
        device.queue.writeBuffer(buffer, 0, parameters);
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: [0, 0, 0, 0],
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        present(canvas);
        await device.queue.onSubmittedWorkDone();
        if (failed || disposed) throw new Error("Fog GPU device lost");
      },
      dispose() {
        disposed = true;
        device.removeEventListener("uncapturederror", fail);
        maskTexture.destroy();
        buffer.destroy();
        context.unconfigure();
        device.destroy();
      },
    };
  } catch (error) {
    disposed = true;
    device.removeEventListener("uncapturederror", fail);
    device.destroy();
    throw error;
  }
}

export function createWebGlFog(
  size: number,
  lost: () => void,
  document: Document = globalThis.document,
): FogBackend {
  // A canvas cannot change its context type after acquisition. Fallback owns
  // a fresh canvas; the stable presentation canvas remains with MapLibre.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (gl === null) throw new Error("Fog WebGL2 unavailable");
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error("Fog shader allocation failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error("Fog shader compilation failed");
    }
    return shader;
  };
  const vertex = compile(
    gl.VERTEX_SHADER,
    `#version 300 es
out vec2 uv;
void main() {
  vec2 xy = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(xy * 2.0 - 1.0, 0.0, 1.0);
  uv = vec2(xy.x, 1.0 - xy.y);
}`,
  );
  const fragment = compile(gl.FRAGMENT_SHADER, ATLAS_GLSL);
  const program = gl.createProgram();
  if (program === null) throw new Error("Fog program allocation failed");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error("Fog program link failed");
  }
  const texture = gl.createTexture();
  if (texture === null) {
    gl.deleteProgram(program);
    throw new Error("Fog texture allocation failed");
  }
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "u_mask"), 0);
  const parametersUniform = gl.getUniformLocation(program, "p[0]");
  const onLost = (event: Event) => {
    event.preventDefault();
    lost();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  return {
    kind: "webgl2",
    canvas,
    async render(mask, parameters, maskChanged, present) {
      if (gl.isContextLost()) throw new Error("Fog WebGL context lost");
      gl.viewport(0, 0, size, size);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // DOM source rows are top-to-bottom; the shader uses the same north-up
      // UVs as WebGPU. Do not flip these a second time at upload.
      if (maskChanged)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          mask,
        );
      gl.uniform4fv(parametersUniform, parameters);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.getError() !== gl.NO_ERROR)
        throw new Error("Fog WebGL render failed");
      present(canvas);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

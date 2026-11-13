// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  bezier,
  chainNeighbours,
  latticeNeighbours,
  latticeTriangles,
  quadPoint,
  type Point,
  type Quad,
} from "./geometry";
import {
  FRAME_FLOATS,
  STATE_FLOATS,
  SUBSTEPS,
  TELEPORT_PX,
  panelSprings,
  ribbonSprings,
} from "./physics";
import { ADVANCE_WGSL, FROST_WGSL, GLASS_WGSL, RELAX_WGSL } from "./shaders";

export type Rgb = readonly [red: number, green: number, blue: number];

/** One block of glass, where the page drew it this frame. */
export interface GlassPanel {
  readonly quad: Quad;
  /** Untransformed size and corner radius, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** The block's own colour, 0–1 per channel. */
  readonly tint: Rgb;
  /** 1 while the block's seat drives. */
  readonly active: number;
  readonly opacity: number;
  readonly mass: number;
  /** The edge the block hangs from or rests on. */
  readonly anchor: "top" | "bottom";
  /** A tile inside a block: no shadow, no halo, a thinner body. */
  readonly tile: boolean;
  /** How strongly warm light wraps the rim, 0–1. */
  readonly halo: number;
  readonly swayX: number;
}

/** A ribbon of light from the leader's card to the follower's. */
export interface GlassRibbon {
  readonly curve: readonly [Point, Point, Point, Point];
  readonly leader: Rgb;
  readonly follower: Rgb;
  /** +1 when the leader is at the curve's start, -1 at its end. */
  readonly flow: 1 | -1;
  readonly width: number;
  readonly intensity: number;
}

export interface GlassScene {
  readonly panels: readonly GlassPanel[];
  readonly ribbons: readonly GlassRibbon[];
  /** The map's bearing and pitch, in degrees. */
  readonly bearing: number;
  readonly pitch: number;
  readonly dark: boolean;
  /** False under reduced motion: the glass holds still and the light stops. */
  readonly motion: boolean;
  /** Seconds, for the ribbons' flow. */
  readonly time: number;
  /** Seconds since the previous frame. */
  readonly dt: number;
}

export interface WorldRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DockGlass {
  /** Simulates and draws one frame. */
  draw(scene: GlassScene): void;
  /**
   * Takes the world the glass refracts. Call it in the task the world was
   * drawn in: a WebGPU or WebGL canvas holds its frame only until then.
   */
  world(source: HTMLCanvasElement, rect: WorldRect): void;
  /** The network's state as the GPU holds it, eight floats a node. */
  readState(): Promise<Float32Array>;
  dispose(): void;
}

const PANEL_COLUMNS = 12;
const PANEL_ROWS = 9;
const TILE_COLUMNS = 4;
const TILE_ROWS = 4;
const RIBBON_NODES = 40;
/** How far the shadow and the halo reach past a block's edge. */
const MARGIN = 40;
const MAX_PIXEL_RATIO = 2;

const PANEL_FLOATS = 16;
const RIBBON_FLOATS = 12;
const LIGHT_FLOATS = 16;

interface Layout {
  readonly key: string;
  readonly nodes: number;
  readonly indices: number;
  readonly ribbonFirst: readonly number[];
}

function layoutKey(scene: GlassScene): string {
  return `${scene.panels.map((panel) => (panel.tile ? "t" : "b")).join("")}:${scene.ribbons.length}`;
}

function storage(device: GPUDevice, bytes: number, extra = 0): GPUBuffer {
  return device.createBuffer({
    size: Math.max(64, Math.ceil(bytes / 16) * 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
  });
}

export async function createDockGlass(
  canvas: HTMLCanvasElement,
  lost: () => void,
): Promise<DockGlass> {
  const gpu = globalThis.navigator?.gpu;
  if (gpu === undefined) throw new Error("WebGPU unavailable");
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error("WebGPU adapter unavailable");
  const device = await adapter.requestDevice();
  let disposed = false;
  const fail = () => {
    if (!disposed) lost();
  };
  void device.lost.then(fail);
  device.addEventListener("uncapturederror", fail);

  const context = canvas.getContext("webgpu");
  if (context === null) throw new Error("WebGPU canvas unavailable");
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const blend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  };
  const glassModule = device.createShaderModule({ code: GLASS_WGSL });
  const frostModule = device.createShaderModule({ code: FROST_WGSL });
  const [advance, relax, panelPipeline, ribbonPipeline, frostPipeline] =
    await Promise.all([
      device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: device.createShaderModule({ code: ADVANCE_WGSL }),
          entryPoint: "advance",
        },
      }),
      device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: device.createShaderModule({ code: RELAX_WGSL }),
          entryPoint: "relax",
        },
      }),
      device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: glassModule, entryPoint: "panelVertex" },
        fragment: {
          module: glassModule,
          entryPoint: "panelFragment",
          targets: [{ format, blend }],
        },
        primitive: { topology: "triangle-list" },
      }),
      device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: glassModule, entryPoint: "ribbonVertex" },
        fragment: {
          module: glassModule,
          entryPoint: "ribbonFragment",
          targets: [{ format, blend }],
        },
        primitive: { topology: "triangle-strip" },
      }),
      device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: frostModule, entryPoint: "fullscreen" },
        fragment: {
          module: frostModule,
          entryPoint: "downsample",
          targets: [{ format: "rgba8unorm" }],
        },
        primitive: { topology: "triangle-list" },
      }),
    ]);

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
  const sim = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const light = device.createBuffer({
    size: LIGHT_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const blank = device.createTexture({
    size: [1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  let worldTexture: GPUTexture | undefined;
  let frostTexture: GPUTexture | undefined;
  let worldRect: WorldRect | undefined;
  let worldBinding: GPUBindGroup | undefined;

  let layout: Layout | undefined;
  let frames: GPUBuffer | undefined;
  let neighbours: GPUBuffer | undefined;
  let states: [GPUBuffer, GPUBuffer] | undefined;
  let indexBuffer: GPUBuffer | undefined;
  let panels: GPUBuffer | undefined;
  let ribbons: GPUBuffer | undefined;
  let groups:
    | {
        advance: GPUBindGroup;
        relax: [GPUBindGroup, GPUBindGroup];
        panel: GPUBindGroup;
        ribbon: GPUBindGroup;
      }
    | undefined;
  let reset = true;

  function bindGlass(): void {
    if (!frames || !states || !panels || !ribbons) return;
    groups = {
      advance: device.createBindGroup({
        layout: advance.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: frames } },
          { binding: 1, resource: { buffer: states[0] } },
          { binding: 2, resource: { buffer: sim } },
        ],
      }),
      relax: [0, 1].map((from) =>
        device.createBindGroup({
          layout: relax.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: frames! } },
            { binding: 1, resource: { buffer: neighbours! } },
            { binding: 2, resource: { buffer: states![from]! } },
            { binding: 3, resource: { buffer: states![1 - from]! } },
            { binding: 4, resource: { buffer: sim } },
          ],
        }),
      ) as [GPUBindGroup, GPUBindGroup],
      panel: device.createBindGroup({
        layout: panelPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: frames } },
          { binding: 1, resource: { buffer: states[0] } },
          { binding: 2, resource: { buffer: panels } },
          { binding: 3, resource: { buffer: light } },
          {
            binding: 4,
            resource: (frostTexture ?? blank).createView(),
          },
          { binding: 5, resource: sampler },
        ],
      }),
      ribbon: device.createBindGroup({
        layout: ribbonPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: frames } },
          { binding: 1, resource: { buffer: states[0] } },
          { binding: 3, resource: { buffer: light } },
          { binding: 6, resource: { buffer: ribbons } },
        ],
      }),
    };
  }

  function rebuild(scene: GlassScene): Layout {
    const key = layoutKey(scene);
    let nodes = 0;
    const neighbourParts: Int32Array[] = [];
    const indexParts: Uint32Array[] = [];
    for (const panel of scene.panels) {
      const columns = panel.tile ? TILE_COLUMNS : PANEL_COLUMNS;
      const rows = panel.tile ? TILE_ROWS : PANEL_ROWS;
      neighbourParts.push(latticeNeighbours(columns, rows, nodes));
      indexParts.push(latticeTriangles(columns, rows, nodes));
      nodes += columns * rows;
    }
    const ribbonFirst: number[] = [];
    for (let ribbon = 0; ribbon < scene.ribbons.length; ribbon += 1) {
      ribbonFirst.push(nodes);
      neighbourParts.push(chainNeighbours(RIBBON_NODES, nodes));
      nodes += RIBBON_NODES;
    }
    const indexCount = indexParts.reduce((sum, part) => sum + part.length, 0);
    for (const buffer of [frames, neighbours, indexBuffer, panels, ribbons]) {
      buffer?.destroy();
    }
    states?.forEach((buffer) => buffer.destroy());
    frames = storage(device, nodes * FRAME_FLOATS * 4);
    neighbours = storage(device, nodes * 16);
    states = [
      storage(device, nodes * STATE_FLOATS * 4, GPUBufferUsage.COPY_SRC),
      storage(device, nodes * STATE_FLOATS * 4),
    ];
    panels = storage(device, scene.panels.length * PANEL_FLOATS * 4);
    ribbons = storage(device, scene.ribbons.length * RIBBON_FLOATS * 4);
    indexBuffer = device.createBuffer({
      size: Math.max(16, indexCount * 4),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    const allNeighbours = new Int32Array(nodes * 4);
    let at = 0;
    for (const part of neighbourParts) {
      allNeighbours.set(part, at);
      at += part.length;
    }
    device.queue.writeBuffer(neighbours, 0, allNeighbours);
    const allIndices = new Uint32Array(Math.max(4, indexCount));
    at = 0;
    for (const part of indexParts) {
      allIndices.set(part, at);
      at += part.length;
    }
    device.queue.writeBuffer(indexBuffer, 0, allIndices);
    reset = true;
    bindGlass();
    return { key, nodes, indices: indexCount, ribbonFirst };
  }

  function packFrames(scene: GlassScene, current: Layout): Float32Array {
    const out = new Float32Array(current.nodes * FRAME_FLOATS);
    let node = 0;
    scene.panels.forEach((panel, index) => {
      const columns = panel.tile ? TILE_COLUMNS : PANEL_COLUMNS;
      const rows = panel.tile ? TILE_ROWS : PANEL_ROWS;
      const margin = panel.tile ? 0 : MARGIN;
      const spanX = panel.width + margin * 2;
      const spanY = panel.height + margin * 2;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const localX = -margin + (spanX * column) / (columns - 1);
          const localY = -margin + (spanY * row) / (rows - 1);
          const [x, y] = quadPoint(
            panel.quad,
            panel.width > 0 ? localX / panel.width : 0,
            panel.height > 0 ? localY / panel.height : 0,
          );
          const down = panel.height > 0 ? localY / panel.height : 0;
          const springs = panelSprings(
            panel.anchor === "bottom" ? 1 - down : down,
            panel.tile ? panel.mass * 0.6 : panel.mass,
          );
          out.set(
            [
              x,
              y,
              localX,
              localY,
              springs.anchor,
              springs.coupling,
              springs.damping,
              springs.maxOffset,
              index,
              0,
              0,
              0,
            ],
            node * FRAME_FLOATS,
          );
          node += 1;
        }
      }
    });
    scene.ribbons.forEach((ribbon, index) => {
      for (let k = 0; k < RIBBON_NODES; k += 1) {
        const along = k / (RIBBON_NODES - 1);
        const [x, y] = bezier(...ribbon.curve, along);
        const springs = ribbonSprings(along);
        out.set(
          [
            x,
            y,
            0,
            0,
            springs.anchor,
            springs.coupling,
            springs.damping,
            springs.maxOffset,
            index,
            along,
            1,
            0,
          ],
          node * FRAME_FLOATS,
        );
        node += 1;
      }
    });
    return out;
  }

  function packPanels(scene: GlassScene): Float32Array {
    const out = new Float32Array(
      Math.max(1, scene.panels.length) * PANEL_FLOATS,
    );
    scene.panels.forEach((panel, index) => {
      out.set(
        [
          panel.width,
          panel.height,
          panel.radius,
          panel.active,
          ...panel.tint,
          panel.opacity,
          panel.tile ? 1 : 0,
          panel.tile ? 0 : MARGIN,
          panel.swayX,
          panel.halo,
        ],
        index * PANEL_FLOATS,
      );
    });
    return out;
  }

  function packRibbons(scene: GlassScene, current: Layout): Float32Array {
    const out = new Float32Array(
      Math.max(1, scene.ribbons.length) * RIBBON_FLOATS,
    );
    scene.ribbons.forEach((ribbon, index) => {
      out.set(
        [
          ...ribbon.leader,
          current.ribbonFirst[index]!,
          ...ribbon.follower,
          RIBBON_NODES,
          ribbon.flow,
          ribbon.width,
          ribbon.intensity,
          scene.motion ? 1 : 0,
        ],
        index * RIBBON_FLOATS,
      );
    });
    return out;
  }

  function fitCanvas(): void {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  return {
    draw(scene) {
      if (disposed) return;
      fitCanvas();
      if (layout === undefined || layout.key !== layoutKey(scene)) {
        layout =
          scene.panels.length + scene.ribbons.length > 0
            ? rebuild(scene)
            : undefined;
      }
      const encoder = device.createCommandEncoder();
      const target = context.getCurrentTexture().createView();
      if (layout === undefined || groups === undefined) {
        encoder
          .beginRenderPass({
            colorAttachments: [
              {
                view: target,
                loadOp: "clear",
                storeOp: "store",
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
              },
            ],
          })
          .end();
        device.queue.submit([encoder.finish()]);
        return;
      }
      device.queue.writeBuffer(frames!, 0, packFrames(scene, layout));
      device.queue.writeBuffer(panels!, 0, packPanels(scene));
      device.queue.writeBuffer(ribbons!, 0, packRibbons(scene, layout));
      const dt = Math.min(Math.max(scene.dt, 0), 1 / 20);
      const simulation = new ArrayBuffer(32);
      new Float32Array(simulation, 0, 4).set([
        dt,
        dt / SUBSTEPS,
        TELEPORT_PX,
        reset || !scene.motion ? 1 : 0,
      ]);
      new Uint32Array(simulation, 16, 1)[0] = layout.nodes;
      device.queue.writeBuffer(sim, 0, simulation);
      reset = false;
      const ratio = canvas.width / Math.max(1, canvas.clientWidth);
      device.queue.writeBuffer(
        light,
        0,
        new Float32Array([
          canvas.clientWidth,
          canvas.clientHeight,
          ratio,
          scene.time,
          (scene.bearing * Math.PI) / 180,
          scene.pitch,
          worldRect === undefined ? 0 : 1,
          0,
          worldRect?.left ?? 0,
          worldRect?.top ?? 0,
          worldRect?.width ?? 1,
          worldRect?.height ?? 1,
          scene.dark ? 1 : 0,
          0,
          0,
          0,
        ]),
      );

      const workgroups = Math.ceil(layout.nodes / 64);
      const compute = encoder.beginComputePass();
      compute.setPipeline(advance);
      compute.setBindGroup(0, groups.advance);
      compute.dispatchWorkgroups(workgroups);
      if (scene.motion) {
        compute.setPipeline(relax);
        for (let step = 0; step < SUBSTEPS; step += 1) {
          compute.setBindGroup(0, groups.relax[step % 2]!);
          compute.dispatchWorkgroups(workgroups);
        }
      }
      compute.end();

      const glass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      if (scene.ribbons.length > 0) {
        glass.setPipeline(ribbonPipeline);
        glass.setBindGroup(0, groups.ribbon);
        for (let ribbon = 0; ribbon < scene.ribbons.length; ribbon += 1) {
          glass.draw(RIBBON_NODES * 2, 1, 0, ribbon);
        }
      }
      if (layout.indices > 0) {
        glass.setPipeline(panelPipeline);
        glass.setBindGroup(0, groups.panel);
        glass.setIndexBuffer(indexBuffer!, "uint32");
        glass.drawIndexed(layout.indices);
      }
      glass.end();
      device.queue.submit([encoder.finish()]);
    },

    world(source, rect) {
      if (disposed || source.width === 0 || source.height === 0) return;
      if (
        worldTexture === undefined ||
        worldTexture.width !== source.width ||
        worldTexture.height !== source.height
      ) {
        worldTexture?.destroy();
        frostTexture?.destroy();
        worldTexture = device.createTexture({
          size: [source.width, source.height],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        frostTexture = device.createTexture({
          size: [
            Math.max(1, Math.ceil(source.width / 4)),
            Math.max(1, Math.ceil(source.height / 4)),
          ],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        worldBinding = device.createBindGroup({
          layout: frostPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: worldTexture.createView() },
            { binding: 1, resource: sampler },
          ],
        });
        bindGlass();
      }
      try {
        device.queue.copyExternalImageToTexture(
          { source },
          { texture: worldTexture },
          [source.width, source.height],
        );
      } catch {
        // A world the page may not read (or one already gone) is not
        // refracted; the glass keeps its own smoke.
        worldRect = undefined;
        return;
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: frostTexture!.createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setPipeline(frostPipeline);
      pass.setBindGroup(0, worldBinding!);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
      worldRect = rect;
    },

    async readState() {
      if (layout === undefined || states === undefined)
        return new Float32Array();
      const bytes = layout.nodes * STATE_FLOATS * 4;
      const read = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(states[0], 0, read, 0, bytes);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const copy = new Float32Array(read.getMappedRange().slice(0));
      read.destroy();
      return copy;
    },

    dispose() {
      disposed = true;
      device.removeEventListener("uncapturederror", fail);
      device.destroy();
    },
  };
}

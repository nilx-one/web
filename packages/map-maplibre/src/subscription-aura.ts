// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SubscriptionAuraTier } from "@nilx-one/map-contract";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
} from "three";

// Three intersecting sheets in the body's metre-scaled Y-up frame. Unlike a
// screen overlay these follow the body, terrain, heading and depth buffer.
// A single mesh/material keeps both tiers to one extra draw call per body.
function auraGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let sheet = 0; sheet < 3; sheet += 1) {
    const angle = (sheet * Math.PI) / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 1],
    ]) {
      const x = (u! - 0.5) * 3.6;
      positions.push(x * Math.cos(angle), v! * 3.4 - 0.15, x * Math.sin(angle));
      uvs.push(u!, v!);
    }
  }
  return new BufferGeometry()
    .setAttribute("position", new Float32BufferAttribute(positions, 3))
    .setAttribute("uv", new Float32BufferAttribute(uvs, 2));
}

export const SUBSCRIPTION_AURA_PALETTE = {
  exclusive: { color: 0xffd574, core: 0xfff9e4, intensity: 1 },
  special: { color: 0xa777ff, core: 0xe1ccff, intensity: 0.46 },
} as const;

export const SUBSCRIPTION_AURA_TRANSITION_SECONDS = 0.7;

export function createSubscriptionAura(tier: SubscriptionAuraTier) {
  const uniforms = {
    uTime: { value: 0 },
    uTint: { value: new Color() },
    uCore: { value: new Color() },
    uIntensity: { value: 1 },
  };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    forceSinglePass: true,
    toneMapped: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uTint;
      uniform vec3 uCore;
      uniform float uIntensity;

      float star(vec2 p) {
        float r = length(p);
        float cross = exp(-abs(p.x) * 240.0) * exp(-abs(p.y) * 34.0)
                    + exp(-abs(p.y) * 240.0) * exp(-abs(p.x) * 34.0);
        return cross + 0.65 * exp(-r * 140.0);
      }

      void main() {
        vec2 p = (vUv - vec2(0.5, 0.38)) * vec2(1.06, 1.0);
        float r = length(p);
        float angle = atan(p.y, p.x);
        // Slow breathing, never a flash. Reduced motion freezes uTime at 0.
        float breath = 0.94 + 0.06 * sin(uTime * 1.4);
        float halo = exp(-dot(p * vec2(3.5, 2.25), p * vec2(3.5, 2.25)) * 4.0);
        float rays = pow(abs(cos(angle * 9.0 + 0.09 * sin(uTime * 0.6))), 38.0)
                   * exp(-r * 8.0) * smoothstep(0.035, 0.12, r);
        // Fine rising ribbons and an interrupted elliptical hero halo.
        float ribbon = 0.0;
        for (int i = 0; i < 3; i++) {
          float f = float(i);
          float curve = (0.11 + f * 0.045) * sin(vUv.y * 6.0 - uTime * 0.35 + f * 2.1);
          ribbon += exp(-abs(p.x - curve) * 160.0);
        }
        ribbon *= smoothstep(0.08, 0.25, vUv.y) * (1.0 - smoothstep(0.68, 0.94, vUv.y));
        vec2 oval = (vUv - vec2(0.5, 0.48)) / vec2(0.24, 0.43);
        float arc = exp(-abs(length(oval) - 1.0) * 120.0)
                  * pow(0.5 + 0.5 * sin(atan(oval.y, oval.x) * 3.0 + uTime * 0.3), 3.0);
        float sparks = 0.0;
        for (int i = 0; i < 7; i++) {
          float f = float(i);
          float y = fract(f * 0.137 + uTime * 0.035);
          vec2 point = vec2(0.5 + sin(f * 7.13) * (0.16 + 0.06 * sin(f)), 0.08 + y * 0.83);
          float life = sin(y * 3.14159265);
          sparks += star(vUv - point) * life * life;
        }
        float edge = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x))
                   * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
        vec3 light = uTint * (halo * 0.18 + rays * 0.8 + ribbon * 0.08 + arc * 0.12)
                   + uCore * sparks * 0.42;
        gl_FragColor = vec4(light * breath * uIntensity * edge, 1.0);
      }
    `,
  });
  const root = new Mesh(auraGeometry(), material);
  root.name = "subscription-aura";
  root.renderOrder = 1;
  let disposed = false;
  let target: SubscriptionAuraTier | undefined = tier;
  let started: number | undefined;
  let fromIntensity = 0;
  let toIntensity: number = SUBSCRIPTION_AURA_PALETTE[tier].intensity;
  uniforms.uIntensity.value = 0;
  uniforms.uTint.value.setHex(SUBSCRIPTION_AURA_PALETTE[tier].color);
  uniforms.uCore.value.setHex(SUBSCRIPTION_AURA_PALETTE[tier].core);
  const fromTint = uniforms.uTint.value.clone();
  const fromCore = uniforms.uCore.value.clone();
  const toTint = fromTint.clone();
  const toCore = fromCore.clone();

  function sample(seconds: number, reducedMotion: boolean): void {
    const time = Number.isFinite(seconds) ? seconds : 0;
    started ??= time;
    const progress = reducedMotion
      ? 1
      : Math.min(
          1,
          Math.max(0, (time - started) / SUBSCRIPTION_AURA_TRANSITION_SECONDS),
        );
    const eased = progress * progress * (3 - 2 * progress);
    uniforms.uTint.value.lerpColors(fromTint, toTint, eased);
    uniforms.uCore.value.lerpColors(fromCore, toCore, eased);
    uniforms.uIntensity.value =
      progress === 1
        ? toIntensity
        : fromIntensity + (toIntensity - fromIntensity) * eased;
    uniforms.uTime.value = reducedMotion ? 0 : time;
  }

  function setTier(
    next: SubscriptionAuraTier | undefined,
    seconds: number,
    reducedMotion: boolean,
  ): void {
    sample(seconds, reducedMotion);
    if (target === next) return;
    fromTint.copy(uniforms.uTint.value);
    fromCore.copy(uniforms.uCore.value);
    fromIntensity = uniforms.uIntensity.value;
    if (next !== undefined) {
      const palette = SUBSCRIPTION_AURA_PALETTE[next];
      toTint.setHex(palette.color);
      toCore.setHex(palette.core);
      toIntensity = palette.intensity;
    } else {
      toIntensity = 0;
    }
    target = next;
    started = Number.isFinite(seconds) ? seconds : 0;
    sample(seconds, reducedMotion);
  }
  return {
    root,
    setTier,
    sample,
    fadedOut: () => target === undefined && uniforms.uIntensity.value === 0,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      root.geometry.dispose();
      material.dispose();
    },
  };
}

// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

// Experimental only: MapLibre currently owns a WebGL2 context/depth buffer.
// This TSL equivalent runs in a separate, depth-complete comparison scene.
import {
  AdditiveBlending,
  DoubleSide,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import {
  abs,
  atan,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec4,
  Fn,
} from "three/tsl";
import type { SubscriptionAuraUniforms } from "../../src/subscription-aura";

export function createAuraNodeMaterial(state: SubscriptionAuraUniforms) {
  const time = uniform(0).onRenderUpdate(() => state.uTime.value);
  const intensity = uniform(0).onRenderUpdate(() => state.uIntensity.value);
  const tint = uniform(state.uTint.value);
  const coreColor = uniform(state.uCore.value);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    forceSinglePass: true,
    toneMapped: false,
  });
  material.fragmentNode = Fn(() => {
    const v = uv();
    const p = vec2(v.x.sub(0.5).mul(3), v.y.mul(2.55).sub(1.17));
    const r = length(p);
    const angle = atan(p.y, p.x);
    const breath = sin(time.mul(1.4)).mul(0.04).add(0.96);
    const mantle = p.div(vec2(0.58, 0.88));
    const halo = exp(dot(mantle, mantle).mul(-2.2));
    const column = vec2(p.x.div(0.27), max(abs(p.y).sub(0.32), 0).div(0.32));
    const core = exp(dot(column, column).mul(-2));
    const hands = vec2(abs(p.x).sub(0.27).div(0.27), p.y.add(0.06).div(0.4));
    const flare = exp(dot(hands, hands).mul(-2));
    const fan = pow(
      abs(
        sin(
          angle
            .mul(43)
            .add(sin(angle.mul(7)).mul(2))
            .add(time.mul(0.06)),
        ),
      ),
      12,
    );
    const rays = fan.mul(exp(r.mul(-5.8))).mul(smoothstep(0.18, 0.42, r));
    const ribbon = float(0).toVar();
    for (let i = 0; i < 2; i++) {
      const curve = sin(
        p.y
          .mul(3)
          .sub(time.mul(0.3))
          .add(i * 3.14),
      ).mul(0.29 + i * 0.09);
      ribbon.addAssign(exp(abs(p.x.sub(curve)).mul(-95)));
    }
    ribbon.mulAssign(exp(p.y.mul(p.y).mul(-2.4)));
    const oval = p.sub(vec2(0, 0.1)).div(vec2(0.72, 1.03));
    const arc = exp(abs(length(oval).sub(1)).mul(-95)).mul(
      pow(
        sin(atan(oval.y, oval.x).mul(2).sub(time.mul(0.45)))
          .mul(0.5)
          .add(0.5),
        6,
      ),
    );
    const sparks = float(0).toVar();
    for (let i = 0; i < 9; i++) {
      const y = fract(time.mul(0.035).add(i * 0.137));
      const point = vec2(
        0.5 + Math.sin(i * 7.13) * (0.13 + 0.035 * Math.sin(i)),
        y.mul(0.72).add(0.12),
      );
      const d = v.sub(point);
      const cross = exp(abs(d.x).mul(-240))
        .mul(exp(abs(d.y).mul(-34)))
        .add(exp(abs(d.y).mul(-240)).mul(exp(abs(d.x).mul(-34))));
      const star = cross.add(exp(length(d).mul(-140)).mul(0.65));
      const life = sin(y.mul(Math.PI));
      sparks.addAssign(star.mul(life).mul(life));
    }
    const edge = smoothstep(0, 0.08, v.x)
      .mul(float(1).sub(smoothstep(0.92, 1, v.x)))
      .mul(smoothstep(0, 0.08, v.y))
      .mul(float(1).sub(smoothstep(0.92, 1, v.y)));
    const light = tint
      .mul(
        halo
          .mul(0.65)
          .add(rays.mul(1.1))
          .add(ribbon.mul(0.1))
          .add(arc.mul(0.24)),
      )
      .add(
        coreColor.mul(
          core.mul(0.72).add(flare.mul(0.48)).add(sparks.mul(0.34)),
        ),
      );
    return vec4(light.mul(breath).mul(intensity).mul(edge), 1);
  })();
  return material;
}

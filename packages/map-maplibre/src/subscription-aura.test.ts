// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AdditiveBlending } from "three";
import { describe, expect, it, vi } from "vitest";
import { createSubscriptionAura } from "./subscription-aura";

describe("subscription hero aura", () => {
  it("uses one depth-tested additive mesh, with a weaker violet Special", () => {
    const aura = createSubscriptionAura("exclusive");
    const material = aura.root.material;
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    aura.sample(0, true);
    const intensity = material.uniforms.uIntensity!.value as number;
    aura.setTier("special", 1, true);
    expect(material.uniforms.uIntensity!.value).toBeLessThan(intensity / 2);
    expect(material.uniforms.uTint!.value.getHex()).toBe(0xa777ff);
    aura.dispose();
  });
  it("animates acquisition, both tier directions, interruption and disappearance continuously", () => {
    const aura = createSubscriptionAura("special");
    const intensity = () =>
      aura.root.material.uniforms.uIntensity!.value as number;
    aura.sample(0, false);
    expect(intensity()).toBe(0);
    aura.sample(0.35, false);
    expect(intensity()).toBeCloseTo(0.23);
    aura.sample(0.7, false);
    expect(intensity()).toBe(0.46);
    aura.setTier("exclusive", 1, false);
    expect(intensity()).toBe(0.46);
    aura.sample(1.35, false);
    expect(intensity()).toBeCloseTo(0.73);
    const interrupted = intensity();
    aura.setTier("special", 1.35, false);
    expect(intensity()).toBe(interrupted);
    aura.sample(2.1, false);
    expect(intensity()).toBe(0.46);
    aura.setTier("exclusive", 3, false);
    aura.sample(4, false);
    expect(intensity()).toBe(1);
    aura.setTier(undefined, 4, false);
    expect(aura.fadedOut()).toBe(false);
    aura.sample(4.35, false);
    expect(intensity()).toBeCloseTo(0.5);
    aura.sample(5, false);
    expect(aura.fadedOut()).toBe(true);
    aura.dispose();
  });
  it("freezes reduced motion and disposes each owned GPU resource once", () => {
    const aura = createSubscriptionAura("exclusive");
    aura.sample(10, false);
    expect(aura.root.material.uniforms.uTime!.value).toBe(10);
    aura.sample(11, true);
    expect(aura.root.material.uniforms.uTime!.value).toBe(0);
    const geometry = vi.spyOn(aura.root.geometry, "dispose");
    const material = vi.spyOn(aura.root.material, "dispose");
    aura.dispose();
    aura.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });
});

// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * A Core port whose inventory commands go through Market, and whose every
 * other answer is Core's own.
 *
 * Each method is bound to Core once and handed out as that same function from
 * then on. A hook that lists `core.someMethod` among its effect dependencies
 * reads it on every render: a function bound anew on each read is a new
 * dependency each time, so the effect would tear down and ask Core again on
 * every render, and an effect that stores what Core answered would never
 * stop rendering.
 */
export function withMarketInventory<
  Core extends object,
  Command extends (...args: never[]) => unknown,
>(
  core: Core,
  inventoryCommand: Command,
): Omit<Core, "applyInventoryCommand"> & {
  readonly applyInventoryCommand: Command;
} {
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(core, {
    get(target, property) {
      if (property === "applyInventoryCommand") return inventoryCommand;
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      const held = bound.get(property);
      if (held !== undefined) return held;
      const method: unknown = (value as (...args: unknown[]) => unknown).bind(
        target,
      );
      bound.set(property, method);
      return method;
    },
  }) as Omit<Core, "applyInventoryCommand"> & {
    readonly applyInventoryCommand: Command;
  };
}

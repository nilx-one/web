// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export function SettingsSliderStops({
  labels,
  current,
  colors,
  pending = 0,
}: {
  readonly labels: readonly string[];
  readonly current: number;
  readonly colors?: readonly string[];
  readonly pending?: number;
}) {
  return (
    <span className="interface-settings__slider-stops" aria-hidden="true">
      {labels.map((label, index) => (
        <span
          key={index}
          data-current={index === current}
          data-pending={index < pending}
          style={{
            left: `${(index / Math.max(1, labels.length - 1)) * 100}%`,
            color: colors?.[index],
          }}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

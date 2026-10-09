// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Shared presentation-only range control for a small ordered set of choices. */
export interface SettingsSliderOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
}

export interface SettingsSliderProps<T extends string | number> {
  readonly id: string;
  readonly label: string;
  readonly options: readonly SettingsSliderOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** A previous non-contiguous choice cannot be encoded by a threshold. */
  readonly titleOverride?: string;
  readonly detailOverride?: string;
}

export function SettingsSlider<T extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  titleOverride,
  detailOverride,
}: SettingsSliderProps<T>) {
  const index = options.findIndex((option) => option.value === value);
  const selected = options[index] ?? options[0];
  if (selected === undefined) return null;
  const title = titleOverride ?? selected.label;
  const detail = detailOverride ?? selected.detail;

  return (
    <div className="interface-settings__slider">
      <label htmlFor={id}>
        <strong>{title}</strong>
        {detail === undefined ? null : <small>{detail}</small>}
      </label>
      <input
        id={id}
        type="range"
        name={id}
        min={0}
        max={options.length - 1}
        step={1}
        value={index < 0 ? 0 : index}
        aria-label={label}
        aria-valuetext={title}
        onChange={(event) => {
          const next = options[Number(event.currentTarget.value)];
          if (next !== undefined) onChange(next.value);
        }}
      />
      <span
        className="interface-settings__slider-stops"
        data-stop-count={options.length}
        aria-hidden="true"
      >
        {options.map((option, position) => (
          <span key={option.value} data-current={position === index}>
            {option.label}
          </span>
        ))}
      </span>
    </div>
  );
}

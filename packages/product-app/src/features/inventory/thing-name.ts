// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { isTranslationKey, type Translate } from "../../shell/localization";

/** A thing's name by its Core id, or the id itself when no copy has it yet. */
export function thingName(t: Translate, id: string): string {
  const key = `item.${id}`;
  return isTranslationKey(key) ? t(key) : id;
}

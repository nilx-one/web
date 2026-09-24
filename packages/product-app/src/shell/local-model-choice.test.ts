// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from "vitest";

import {
  chooseLocalModel,
  LOCAL_MODEL_CHOICE_STORAGE_KEY,
  readLocalModelChoice,
} from "./local-model-choice";

beforeEach(() => {
  window.localStorage.clear();
});

describe("the owner's model choice on this device", () => {
  it("is nothing until someone chooses", () => {
    expect(readLocalModelChoice()).toBeUndefined();
  });

  it("is kept under its own key, apart from what the cache holds", () => {
    chooseLocalModel("Llama-3.2-1B-Instruct-q4f16_1-MLC");

    expect(readLocalModelChoice()).toBe("Llama-3.2-1B-Instruct-q4f16_1-MLC");
    expect(window.localStorage.getItem(LOCAL_MODEL_CHOICE_STORAGE_KEY)).toBe(
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    );
  });
});

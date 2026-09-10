// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { resolveAvatarAppearance } from "@nilx-one/application";
import { describe, expect, it } from "vitest";

import {
  chooseDraftModel,
  createAvatarEditorViewState,
  createAvatarFieldViewState,
  draftAppearance,
  draftFromSelection,
  draftSelection,
  equipInDraft,
  type AvatarDraft,
} from "./avatar-editor-view-model";

const DASHA_2 = "dasha-v2-study" as const;

function persisted(model: typeof DASHA_2 | "sky-study" = DASHA_2) {
  return {
    modelId: model,
    appearance: resolveAvatarAppearance(model, undefined),
  };
}

function editor(draft: AvatarDraft, busy = false) {
  return createAvatarEditorViewState({
    subject: "bond",
    persisted: persisted(),
    draft,
    busy,
  });
}

describe("the four-model picker", () => {
  it("offers exactly the four published studies", () => {
    const state = editor(draftFromSelection(persisted()));
    expect(state.models).toHaveLength(4);
    expect(state.models.filter((option) => option.selected)).toHaveLength(1);
    expect(state.models.map((option) => option.thumbnailUrl)).toEqual([
      "/avatars/0.1.0/sky-study.png",
      "/avatars/0.1.0/dasha-study.png",
      "/avatars/0.1.0/kai-study.png",
      "/avatars/0.3.0/dasha-v2-study.png",
    ]);
  });

  it("marks Dasha 2.0 as the study whose clothes change", () => {
    const state = editor(draftFromSelection(persisted()));
    expect(
      state.models.filter((option) => option.editable).map((o) => o.model),
    ).toEqual([DASHA_2]);
  });

  it("shows the chosen body immediately, before anything is saved", () => {
    const draft = chooseDraftModel(
      draftFromSelection(persisted()),
      "kai-study",
    );
    const state = editor(draft);
    expect(state.selected).toBe("kai-study");
    expect(state.scene.modelId).toBe("kai-study");
    expect(state.changed).toBe(true);
  });
});

describe("a study that cannot be customized", () => {
  it("offers no wardrobe and says why", () => {
    const state = editor(
      chooseDraftModel(draftFromSelection(persisted()), "sky-study"),
    );
    expect(state.editable).toBe(false);
    expect(state.sections).toEqual([]);
    expect(state.appearanceNote).toContain("one sculpted study");
    expect(state.appearanceNote).toContain("Dasha 2.0");
  });

  it("keeps its appearance empty however it is reached", () => {
    const draft = chooseDraftModel(
      equipInDraft(draftFromSelection(persisted()), "dress/shift-indigo"),
      "dasha-study",
    );
    expect(draftAppearance(draft)).toEqual({});
    expect(editor(draft).scene.visibleNodes).toEqual([]);
  });
});

describe("Dasha 2.0's wardrobe", () => {
  it("shows a section per slot she publishes, with stills of her own", () => {
    const state = editor(draftFromSelection(persisted()));
    expect(state.editable).toBe(true);
    expect(state.sections.map((section) => section.slot)).toEqual([
      "hair",
      "top",
      "bottom",
      "dress",
      "shoes",
      "accessories",
    ]);
    const hair = state.sections[0];
    expect(hair?.label).toBe("Hair");
    expect(hair?.multiple).toBe(false);
    expect(hair?.items[0]?.thumbnailUrl).toBe(
      "/avatars/0.3.0/dasha-v2-study.hair-swept-bun.png",
    );
    expect(hair?.items.filter((item) => item.selected)).toHaveLength(1);
  });

  it("lets several accessories be worn at once", () => {
    const state = editor(draftFromSelection(persisted()));
    expect(
      state.sections.find((section) => section.slot === "accessories")
        ?.multiple,
    ).toBe(true);
  });

  it("takes the separates off when a dress goes on", () => {
    const draft = equipInDraft(
      draftFromSelection(persisted()),
      "dress/shift-indigo",
    );
    const state = editor(draft);
    const worn = (slot: string) =>
      state.sections
        .find((section) => section.slot === slot)
        ?.items.filter((item) => item.selected)
        .map((item) => item.id) ?? [];
    expect(worn("dress")).toEqual(["dress/shift-indigo"]);
    expect(worn("top")).toEqual([]);
    expect(worn("bottom")).toEqual([]);
  });

  it("takes an item off when it is reached for again", () => {
    const dressed = draftFromSelection(persisted());
    const barefoot = equipInDraft(dressed, "shoes/loafers-black");
    expect(draftAppearance(barefoot).shoes).toBeUndefined();
    expect(editor(barefoot).scene.visibleNodes).toContain("body:feet");
  });

  it("will not empty a slot the model requires", () => {
    const draft = draftFromSelection(persisted());
    expect(draftAppearance(equipInDraft(draft, "hair/swept-bun")).hair).toBe(
      "hair/swept-bun",
    );
  });

  it("ignores an item that was never published", () => {
    const draft = draftFromSelection(persisted());
    expect(equipInDraft(draft, "top/never-published")).toBe(draft);
  });
});

describe("a draft is a draft until it is saved", () => {
  it("has nothing to save until something changes", () => {
    const state = editor(draftFromSelection(persisted()));
    expect(state.changed).toBe(false);
    expect(state.canSave).toBe(false);
  });

  it("can be saved once it differs, and never while it is saving", () => {
    const draft = equipInDraft(
      draftFromSelection(persisted()),
      "shoes/sneakers-white",
    );
    expect(editor(draft).canSave).toBe(true);
    expect(editor(draft, true).canSave).toBe(false);
    expect(editor(draft, true).busy).toBe(true);
  });

  it("finds a study as it was left when a person comes back to it", () => {
    const start = draftFromSelection(persisted());
    const changed = equipInDraft(start, "hair/loose-long");
    const away = chooseDraftModel(changed, "kai-study");
    const back = chooseDraftModel(away, DASHA_2);
    expect(draftAppearance(back).hair).toBe("hair/loose-long");
  });

  it("never carries one study's clothes onto another", () => {
    const inADress = equipInDraft(
      draftFromSelection(persisted()),
      "dress/shift-indigo",
    );
    const asSky = chooseDraftModel(inADress, "sky-study");
    expect(draftSelection(asSky)).toEqual({
      modelId: "sky-study",
      appearance: {},
    });
  });

  it("carries a failure the service reported", () => {
    const state = createAvatarEditorViewState({
      subject: "bond",
      persisted: persisted(),
      draft: chooseDraftModel(draftFromSelection(persisted()), "kai-study"),
      busy: false,
      error: "Couldn’t save this choice. Try again.",
    });
    expect(state.error).toBe("Couldn’t save this choice. Try again.");
  });
});

describe("the settings field", () => {
  it("names the body and offers to change it", () => {
    const field = createAvatarFieldViewState("bond", persisted());
    expect(field.label).toBe("3D model");
    expect(field.modelName).toBe("Dasha 2.0");
    expect(field.openLabel).toContain("Dasha 2.0");
    expect(field.editable).toBe(true);
  });

  it("says whose body it is", () => {
    expect(
      createAvatarFieldViewState("avaia", persisted()).openLabel,
    ).toContain("Avaia");
  });

  it("stands a still in only while the still shows this very outfit", () => {
    expect(createAvatarFieldViewState("bond", persisted()).showStill).toBe(
      true,
    );
    const changed = draftSelection(
      equipInDraft(draftFromSelection(persisted()), "hair/loose-long"),
    );
    expect(createAvatarFieldViewState("bond", changed).showStill).toBe(false);
  });

  it("shows a sculpted study from its own still", () => {
    const field = createAvatarFieldViewState("bond", persisted("sky-study"));
    expect(field.showStill).toBe(true);
    expect(field.stillUrl).toBe("/avatars/0.1.0/sky-study.png");
    expect(field.editable).toBe(false);
  });
});

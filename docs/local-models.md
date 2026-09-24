# Local models

Narration can be rephrased by a model that runs on the device, in the browser, offline once
downloaded. This page is what that means for a person using it and for whoever deploys it.

## What is served

Five entries across four families, all `q4f16_1`, all from `@mlc-ai/web-llm@0.2.84`'s
registry. The table is `packages/narration-webllm/src/model-catalog.json`; `nilx-one/ai`
decides what is in it (`src/inference.rs`, `docs/model-selection.md`).

| Entry                    | Family     | Memory, stated | Licence                     |
| ------------------------ | ---------- | -------------: | --------------------------- |
| Qwen3 0.6B — **default** | `qwen3`    |        1403 MB | Apache-2.0                  |
| Qwen3 1.7B               | `qwen3`    |        2037 MB | Apache-2.0                  |
| SmolLM2 360M             | `smollm2`  |         376 MB | Apache-2.0                  |
| OLMo 2 1B                | `olmo2`    |        1777 MB | Apache-2.0                  |
| Llama 3.2 1B             | `llama3.2` |         879 MB | Llama 3.2 Community License |

**Built with Llama.** The Llama 3.2 entry is Llama 3.2, licensed under the Llama 3.2
Community License, Copyright © Meta Platforms, Inc. All Rights Reserved. Its use is subject
to the [Llama 3.2 Acceptable Use Policy](https://www.llama.com/llama3_2/use-policy).

## Chosen, eligible, default

- **Eligible** is this device's and this surface's answer, per entry: below a runtime floor,
  no `shader-f16`, or over the memory budget the surface declared (the site declares 2048 MB,
  which admits every entry today). An entry that is not eligible is shown with its reason and
  cannot be chosen.
- **Chosen** is the person's, in Settings, stored on this device under
  `nilx-one.localModel.choice`. It is a different fact from what is downloaded: choosing an
  entry fetches nothing, and download and removal act on the chosen entry only.
- **Default** is Qwen3 0.6B. It runs when nothing was chosen, and when a stored choice is no
  longer served or no longer admitted here — Settings says which, and keeps the stored choice
  in case it is admitted again.

Narration reads the same choice when it runs (`createWebLlmNarrationAdapter({ modelId:
readLocalModelChoice })`), so the model Settings shows is the model that loads.

## What a model is allowed to write

The deterministic sentence is the fact; a model only rephrases it, and a rephrasing is shown
only if it adds no number, is a finished sentence, and carries no markup. Everything else
keeps the deterministic sentence. A sentence a model did write carries `producedBy` — adapter,
`model_id` and licence — because Llama's licence reaches the name of any model trained on its
output; `nilx-one/ai`'s presence-journal egress policy reads that mark.

Each family is asked with its own profile (`packages/narration-webllm/src/profiles.ts`). The
token bound follows the tokenizer: the same Ukrainian sentence costs 58 tokens for Llama 3.2
and 143 for SmolLM2, and the single bound of 48 tokens the first profile used cut Qwen3's
rephrasings at about 85 characters.

## Known gap in the foundation

`@aiaiaiai/webllm@0.1.0` sends `enable_thinking: false` with every completion, and
`@mlc-ai/web-llm@0.2.84` answers that flag, for any family, by writing an empty
`<think>…</think>` block into the assistant's turn and into the decoded output. The adapter
strips the block from what it shows. The three families that are not Qwen3 still see it in
their prompt; making the switch a per-call option is the foundation's change to make.

## Not measured yet

Whether each family writes Ukrainian that survives the check has not been measured on a
device. `measureFaithfulness` runs the fixture; its result goes into the entry's
`faithfulness` field, and Settings then labels an entry that keeps fewer than one rephrasing
in five. Until then every entry says it is unmeasured.

---

© 2026 aiaiaiai · aiaiaiai.org

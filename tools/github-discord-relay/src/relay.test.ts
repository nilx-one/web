// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { createHmac, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildMessage,
  githubProjectLookup,
  type ProjectItemLookup,
  verifySignature,
} from "./relay";

const subtle = webcrypto.subtle as SubtleCrypto;
const sender = { login: "0x0sky", html_url: "https://github.com/0x0sky" };
const options = { statusField: "Status" };

function issues(action: string, extra: Record<string, unknown> = {}) {
  return {
    action,
    issue: {
      number: 42,
      title: "Map pins @everyone",
      html_url: "https://github.com/nilx-one/web/issues/42",
      assignees: [{ login: "kai" }],
    },
    repository: { full_name: "nilx-one/web" },
    sender,
    ...extra,
  };
}

function statusChange(
  from: string | null,
  to: string | null,
  fieldType = "single_select",
) {
  return {
    action: "edited",
    projects_v2_item: { content_node_id: "I_1", project_node_id: "PVT_1" },
    changes: {
      field_value: {
        field_node_id: "PVTSSF_1",
        field_type: fieldType,
        from: from && { name: from },
        to: to && { name: to },
      },
    },
    sender,
  };
}

const lookup: ProjectItemLookup = async () => ({
  title: "Map pins",
  url: "https://github.com/nilx-one/web/issues/42",
  reference: "nilx-one/web#42",
  projectTitle: "0x1 roadmap",
  fieldName: "Status",
});

describe("verifySignature", () => {
  const body = '{"zen":"ok"}';
  const good = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;

  it("accepts the GitHub HMAC and rejects anything else", async () => {
    expect(await verifySignature("s3cret", body, good, subtle)).toBe(true);
    expect(await verifySignature("other", body, good, subtle)).toBe(false);
    expect(await verifySignature("s3cret", `${body} `, good, subtle)).toBe(
      false,
    );
    expect(await verifySignature("s3cret", body, null, subtle)).toBe(false);
    expect(await verifySignature("", body, good, subtle)).toBe(false);
  });
});

describe("issue events", () => {
  it("announces a new task with its assignees and blocks mentions", async () => {
    const message = await buildMessage("issues", issues("opened"), options);
    expect(message?.allowed_mentions).toEqual({ parse: [] });
    expect(message?.embeds[0]).toMatchObject({
      title: "nilx-one/web#42 Map pins @everyone",
      url: "https://github.com/nilx-one/web/issues/42",
      description: "New task, assigned to @kai",
      author: { name: "0x0sky" },
    });
  });

  it("reports assignment changes and closing reason", async () => {
    const assigned = await buildMessage(
      "issues",
      issues("assigned", { assignee: { login: "dasha" } }),
      options,
    );
    expect(assigned?.embeds[0]?.description).toBe("Assigned to @dasha");

    const closed = await buildMessage(
      "issues",
      issues("closed", {
        issue: { ...issues("x").issue, state_reason: "not_planned" },
      }),
      options,
    );
    expect(closed?.embeds[0]?.description).toBe("Closed as not planned");
  });

  it("stays quiet on unrelated actions and events", async () => {
    expect(await buildMessage("issues", issues("labeled"), options)).toBeNull();
    expect(await buildMessage("push", {}, options)).toBeNull();
    const secret = issues("opened", {
      repository: { full_name: "nilx-one/secret", private: true },
    });
    expect(await buildMessage("issues", secret, options)).toBeNull();
  });
});

describe("project status changes", () => {
  it("shows the move between status columns", async () => {
    const message = await buildMessage(
      "projects_v2_item",
      statusChange("Todo", "In Progress"),
      { ...options, lookup },
    );
    expect(message?.embeds[0]).toMatchObject({
      title: "nilx-one/web#42 Map pins",
      url: "https://github.com/nilx-one/web/issues/42",
      description: "Status: Todo → In Progress",
      footer: { text: "0x1 roadmap" },
    });
  });

  it("ignores other fields and no-op edits", async () => {
    const otherField: ProjectItemLookup = async (ids) => ({
      ...(await lookup(ids))!,
      fieldName: "Priority",
    });
    for (const [payload, look] of [
      [statusChange("P1", "P0"), otherField],
      [statusChange("Todo", "Todo"), lookup],
      [statusChange(null, null, "text"), lookup],
      [
        statusChange("Todo", "Done"),
        async (ids: Parameters<ProjectItemLookup>[0]) => ({
          ...(await lookup(ids))!,
          private: true,
        }),
      ],
    ] as const) {
      expect(
        await buildMessage("projects_v2_item", payload, {
          ...options,
          lookup: look,
        }),
      ).toBeNull();
    }
  });
});

describe("githubProjectLookup", () => {
  it("resolves issue, project and field names over GraphQL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              content: {
                title: "Map pins",
                url: "https://github.com/nilx-one/web/issues/42",
                number: 42,
                repository: { nameWithOwner: "nilx-one/web" },
              },
              project: { title: "0x1 roadmap", url: "https://github.com/p/1" },
              field: { name: "Status" },
            },
          }),
        ),
    );
    const item = await githubProjectLookup(
      "t0ken",
      fetcher,
    )({
      content: "I_1",
      project: "PVT_1",
      field: "PVTSSF_1",
    });
    expect(item).toEqual({
      title: "Map pins",
      url: "https://github.com/nilx-one/web/issues/42",
      reference: "nilx-one/web#42",
      projectTitle: "0x1 roadmap",
      fieldName: "Status",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/graphql",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer t0ken" }),
      }),
    );
  });
});

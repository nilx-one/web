// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { buildMessage, githubProjectLookup, verifySignature } from "./relay";

export interface Env {
  DISCORD_WEBHOOK_URL: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN?: string;
  STATUS_FIELD?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const body = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, signature))) {
      return new Response("bad signature", { status: 401 });
    }

    const event = request.headers.get("x-github-event") ?? "";
    const options: Parameters<typeof buildMessage>[2] = {
      statusField: env.STATUS_FIELD || "Status",
    };
    if (env.GITHUB_TOKEN)
      options.lookup = githubProjectLookup(env.GITHUB_TOKEN);
    const message = await buildMessage(event, JSON.parse(body), options);
    if (!message) return new Response(null, { status: 204 });

    const discord = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    // A non-2xx makes GitHub mark the delivery failed, so it can be redelivered.
    if (!discord.ok) {
      return new Response(`discord responded ${discord.status}`, {
        status: 502,
      });
    }
    return new Response(null, { status: 204 });
  },
};

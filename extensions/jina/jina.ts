import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jina",
    description:
      "Fetch a webpage and return its content as markdown. Backend-specific fetch tool: prefer web_fetch unless you explicitly want raw Jina Reader output.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const jinaUrl = `https://r.jina.ai/${params.url}`;

      const response = await fetch(jinaUrl, {
        headers: { "Accept": "text/markdown" },
        signal,
      });

      if (!response.ok) {
        return {
          content: [{
            type: "text",
            text: `Failed to fetch: ${response.status} ${response.statusText}`,
          }],
          isError: true,
        };
      }

      const text = await response.text();
      return { content: [{ type: "text", text }] };
    },
  });
}

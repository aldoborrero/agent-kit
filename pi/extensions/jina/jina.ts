import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jina",
    description:
      "Fetch a webpage and return its content as markdown. Use this to read web pages, documentation, articles, etc.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch" }),
    }),
    async execute(toolCallId, params, onUpdate, ctx, signal) {
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

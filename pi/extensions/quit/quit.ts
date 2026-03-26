/**
 * Quit Extension — adds /quit command for clean shutdown.
 *
 * Based on: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/shutdown-command.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("quit", {
		description: "Exit pi cleanly",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}

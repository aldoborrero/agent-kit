/**
 * Skill Namespaces Extension
 *
 * Adds package-based namespacing for skills, similar to Claude Code's
 * `superpowers:brainstorm` syntax. Transforms `/namespace:skill` input
 * into `/skill:skill-name` before pi processes it.
 *
 * Only namespaces listed in ALLOWED_NAMESPACES are registered.
 * Skills are auto-discovered from loaded commands on session start.
 *
 * Usage:
 *   /superpowers:brainstorming     → /skill:brainstorming
 *   /superpowers:writing-plans     → /skill:writing-plans
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Only these directory names are treated as namespaces.
// Skills under other directories are left as plain /skill:name.
const ALLOWED_NAMESPACES = new Set([
	"superpowers",
]);

export default function (pi: ExtensionAPI) {
	// Map of "namespace:name" → skill name
	const aliases = new Map<string, string>();

	pi.on("session_start", async () => {
		aliases.clear();

		const commands = pi.getCommands();
		const skills = commands.filter((c) => c.source === "skill");

		for (const skill of skills) {
			const name = skill.name.startsWith("skill:")
				? skill.name.slice("skill:".length)
				: skill.name;

			const skillPath = (skill as { path?: string }).path;
			if (!skillPath) continue;

			const parts = skillPath.split("/");
			const skillMdIndex = parts.findIndex((p) => p === "SKILL.md");
			if (skillMdIndex < 2) continue;

			// e.g. skills/superpowers/brainstorming/SKILL.md → namespace="superpowers"
			const namespace = parts[skillMdIndex - 2];
			if (!namespace || !ALLOWED_NAMESPACES.has(namespace)) continue;

			aliases.set(`${namespace}:${name}`, name);
		}
	});

	pi.on("input", async (event) => {
		const text = event.text.trim();

		// Match /namespace:skill-name [args]
		const match = text.match(/^\/([a-z0-9_-]+):([a-z0-9_-]+)(.*)/i);
		if (!match) return { action: "continue" as const };

		const [, namespace, name, rest] = match;

		// Only handle allowed namespaces
		if (!ALLOWED_NAMESPACES.has(namespace.toLowerCase())) {
			return { action: "continue" as const };
		}

		const alias = `${namespace}:${name}`;
		if (aliases.has(alias)) {
			return {
				action: "transform" as const,
				text: `/skill:${aliases.get(alias)}${rest}`,
				images: event.images,
			};
		}

		return { action: "continue" as const };
	});
}

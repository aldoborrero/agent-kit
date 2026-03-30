/**
 * Skill Namespaces Extension
 *
 * Replaces pi's built-in skill command registration with namespace-aware
 * commands. Requires `enableSkillCommands: false` in pi settings.
 *
 * Skills under ALLOWED_NAMESPACES directories get prefixed:
 *   /superpowers:brainstorming
 *   /superpowers:writing-plans
 *
 * All other skills keep their plain name:
 *   /ast-grep
 *   /pexpect-cli
 *
 * No duplicates — each skill gets exactly one command.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const ALLOWED_NAMESPACES = new Set([
	"superpowers",
]);

interface SkillInfo {
	name: string;
	description: string;
	namespace: string | null;
	path: string;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return {};

	const yaml = match[1];
	const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
	return { name, description };
}

function discoverSkills(skillsDir: string): SkillInfo[] {
	const skills: SkillInfo[] = [];
	if (!existsSync(skillsDir)) return skills;

	const scanDir = (dir: string, namespace: string | null) => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			const entryPath = join(dir, entry);
			const skillFile = join(entryPath, "SKILL.md");

			if (existsSync(skillFile)) {
				// This is a skill directory
				try {
					const content = readFileSync(skillFile, "utf-8");
					const fm = parseSkillFrontmatter(content);
					const name = fm.name || basename(entryPath);
					skills.push({
						name,
						description: fm.description || `Skill: ${name}`,
						namespace,
						path: skillFile,
					});
				} catch {
					// Skip unreadable skills
				}
			} else {
				// Check if this is a namespace directory (contains subdirs with SKILL.md)
				const candidateNamespace = ALLOWED_NAMESPACES.has(entry) ? entry : null;
				if (candidateNamespace) {
					scanDir(entryPath, candidateNamespace);
				}
			}
		}
	};

	scanDir(skillsDir, null);
	return skills;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		// Discover skills from the package's skills directory
		const packageRoot = join(ctx.cwd);
		const skillsDirs = [
			join(packageRoot, "skills"),
		];

		// Also check the global agent skills directory
		const homeDir = process.env.HOME || process.env.USERPROFILE || "";
		if (homeDir) {
			skillsDirs.push(join(homeDir, ".pi", "agent", "skills"));
		}

		const seen = new Set<string>();

		for (const skillsDir of skillsDirs) {
			const skills = discoverSkills(skillsDir);

			for (const skill of skills) {
				const commandName = skill.namespace
					? `${skill.namespace}:${skill.name}`
					: skill.name;

				// Skip duplicates
				if (seen.has(commandName)) continue;
				seen.add(commandName);

				pi.registerCommand(commandName, {
					description: skill.description,
					handler: async (args) => {
						pi.sendUserMessage(`/skill:${skill.name} ${args}`.trim());
					},
				});
			}
		}
	});
}

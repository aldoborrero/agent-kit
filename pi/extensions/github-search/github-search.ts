import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";

interface TextMatch {
	fragment: string;
	matches: Array<{ text: string; indices: number[] }>;
}

interface CodeSearchResult {
	path: string;
	repository: {
		fullName: string;
		name: string;
		owner: { login: string };
	};
	sha: string;
	url: string;
	textMatches: TextMatch[];
}

function runGhSearch(args: string[]): Promise<CodeSearchResult[]> {
	return new Promise((resolve, reject) => {
		const child = spawn("gh", ["search", "code", ...args, "--json", "path,repository,sha,url,textMatches"], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(stderr || `gh exited with code ${code}`));
				return;
			}

			try {
				const results = JSON.parse(stdout) as CodeSearchResult[];
				resolve(results);
			} catch {
				reject(new Error(`Failed to parse gh output: ${stdout}`));
			}
		});

		child.on("error", (err) => {
			reject(err);
		});
	});
}

function formatResults(results: CodeSearchResult[]): string {
	if (results.length === 0) {
		return "No results found.";
	}

	let output = `Found ${results.length} result(s):\n\n`;

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		const repoName = r.repository.fullName;

		output += `### ${i + 1}. ${repoName}/${r.path}\n`;
		output += `**URL:** ${r.url}\n`;

		if (r.textMatches && r.textMatches.length > 0) {
			output += "**Matches:**\n";
			for (const match of r.textMatches) {
				// Clean up the fragment (remove excessive whitespace)
				const fragment = match.fragment
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0)
					.join("\n");

				if (fragment) {
					output += "```\n" + fragment + "\n```\n";
				}
			}
		}

		output += "\n";
	}

	return output.trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "github_search_code",
		description: `Search code across GitHub repositories using the GitHub API (via gh CLI).

Useful for:
- Finding usage examples of APIs, libraries, or patterns
- Discovering how others implement specific functionality
- Finding configuration examples (Nix, Docker, CI/CD)
- Locating code in specific languages or repositories

Search syntax: https://docs.github.com/search-github/searching-on-github/searching-code`,
		parameters: Type.Object({
			query: Type.String({
				description:
					"Search query. Supports GitHub search syntax (e.g., 'useState lang:typescript', 'filename:flake.nix nixpkgs')",
			}),
			language: Type.Optional(
				Type.String({
					description: "Filter by programming language (e.g., 'python', 'typescript', 'nix')",
				}),
			),
			owner: Type.Optional(
				Type.String({
					description: "Filter by repository owner (e.g., 'nixos', 'microsoft')",
				}),
			),
			repo: Type.Optional(
				Type.String({
					description: "Filter by specific repository (e.g., 'nixos/nixpkgs')",
				}),
			),
			extension: Type.Optional(
				Type.String({
					description: "Filter by file extension (e.g., 'ts', 'nix', 'py')",
				}),
			),
			filename: Type.Optional(
				Type.String({
					description: "Filter by filename (e.g., 'flake.nix', 'Dockerfile')",
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Maximum number of results (default: 10, max: 100)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				// Build gh arguments
				const args: string[] = [params.query];

				if (params.language) {
					args.push("--language", params.language);
				}
				if (params.owner) {
					args.push("--owner", params.owner);
				}
				if (params.repo) {
					args.push("--repo", params.repo);
				}
				if (params.extension) {
					args.push("--extension", params.extension);
				}
				if (params.filename) {
					args.push("--filename", params.filename);
				}

				const limit = Math.min(params.limit ?? 10, 100);
				args.push("--limit", String(limit));

				// Show progress
				onUpdate?.({
					content: [{ type: "text", text: `Searching GitHub for: ${params.query}...` }],
				});

				const results = await runGhSearch(args);
				const output = formatResults(results);

				return {
					content: [{ type: "text", text: output }],
				};
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);

				// Check for common errors
				if (msg.includes("gh: command not found") || msg.includes("ENOENT")) {
					return {
						content: [
							{
								type: "text",
								text: "GitHub CLI (gh) is not installed or not in PATH. Install it from https://cli.github.com/",
							},
						],
						isError: true,
					};
				}

				if (msg.includes("not logged in") || msg.includes("auth login")) {
					return {
						content: [
							{
								type: "text",
								text: "Not authenticated with GitHub. Run `gh auth login` to authenticate.",
							},
						],
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: `GitHub search failed: ${msg}` }],
					isError: true,
				};
			}
		},
	});
}

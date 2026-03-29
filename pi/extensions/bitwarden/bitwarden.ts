/**
 * Bitwarden CLI Extension
 *
 * Provides secure secret retrieval from Bitwarden vault via the `bw` CLI.
 *
 * Security model:
 *   - Agent never sees master password (user must `bw login` + `bw unlock` externally)
 *   - BW_SESSION token must be set in the environment before use
 *   - Search returns metadata only (names, IDs, URIs) — never credential values
 *   - Secret retrieval always requires explicit user confirmation
 *   - Preferred workflow: inject secrets into env vars rather than returning them as text
 *
 * Requirements:
 *   - Bitwarden CLI (`bw`) installed and in PATH
 *   - Vault unlocked with BW_SESSION exported (e.g. via direnv or shell)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runBw(args: string[], session?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const env = { ...process.env };
		if (session) env.BW_SESSION = session;

		const child = spawn("bw", args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
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
				reject(new Error(stderr.trim() || `bw exited with code ${code}`));
				return;
			}
			resolve(stdout.trim());
		});

		child.on("error", (err) => {
			reject(err);
		});
	});
}

function getSession(): string | undefined {
	return process.env.BW_SESSION;
}

function requireSession(): string {
	const session = getSession();
	if (!session) {
		throw new Error(
			"Bitwarden vault is locked. Set BW_SESSION in your environment.\n" +
				"Run: export BW_SESSION=$(bw unlock --raw)",
		);
	}
	return session;
}

function errorResult(msg: string) {
	return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function textResult(msg: string) {
	return { content: [{ type: "text" as const, text: msg }] };
}

function handleCommonErrors(e: unknown) {
	const msg = e instanceof Error ? e.message : String(e);

	if (msg.includes("ENOENT") || msg.includes("command not found") || msg.includes("not recognized")) {
		return errorResult(
			"Bitwarden CLI (`bw`) is not installed or not in PATH.\n" +
				"Install: https://bitwarden.com/help/cli/",
		);
	}

	if (msg.includes("not logged in") || msg.includes("You are not logged in")) {
		return errorResult("Not logged in to Bitwarden. Run `bw login` first.");
	}

	if (msg.includes("locked") || msg.includes("Vault is locked")) {
		return errorResult(
			"Bitwarden vault is locked.\n" +
				"Run: export BW_SESSION=$(bw unlock --raw)",
		);
	}

	return errorResult(`Bitwarden error: ${msg}`);
}

// ---------------------------------------------------------------------------
// Item formatting (metadata only — no secrets)
// ---------------------------------------------------------------------------

interface VaultItem {
	id: string;
	name: string;
	type: number; // 1=login, 2=note, 3=card, 4=identity
	login?: {
		username?: string;
		uris?: Array<{ uri: string }>;
	};
	notes?: string;
	folderId?: string | null;
	organizationId?: string | null;
	collectionIds?: string[];
	revisionDate?: string;
}

const TYPE_LABELS: Record<number, string> = {
	1: "Login",
	2: "Secure Note",
	3: "Card",
	4: "Identity",
};

function formatItemSummary(item: VaultItem, index: number): string {
	const type = TYPE_LABELS[item.type] ?? `Type ${item.type}`;
	let line = `${index + 1}. **${item.name}** (${type})\n   ID: \`${item.id}\``;

	if (item.login?.username) {
		line += `\n   Username: ${item.login.username}`;
	}

	if (item.login?.uris?.length) {
		const uris = item.login.uris.map((u) => u.uri).join(", ");
		line += `\n   URI: ${uris}`;
	}

	return line;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function bitwardenExtension(pi: ExtensionAPI) {
	// -----------------------------------------------------------------------
	// /bw command — status check
	// -----------------------------------------------------------------------

	pi.registerCommand("bw", {
		description: "Show Bitwarden vault status",
		handler: async (_args, ctx) => {
			try {
				const status = await runBw(["status"], getSession());
				const parsed = JSON.parse(status);
				const state = parsed.status ?? "unknown";
				const email = parsed.userEmail ?? "unknown";

				const statusLine =
					state === "unlocked"
						? `Bitwarden: unlocked (${email})`
						: state === "locked"
							? `Bitwarden: locked (${email}) — run: export BW_SESSION=$(bw unlock --raw)`
							: state === "unauthenticated"
								? "Bitwarden: not logged in — run: bw login"
								: `Bitwarden: ${state}`;

				pi.sendMessage(
					{ customType: "bitwarden", content: statusLine, display: true },
					{ triggerTurn: false },
				);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				pi.sendMessage(
					{ customType: "bitwarden", content: `Bitwarden: unavailable (${msg})`, display: true },
					{ triggerTurn: false },
				);
			}
		},
	});

	// -----------------------------------------------------------------------
	// Status indicator on session start
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		try {
			const status = await runBw(["status"], getSession());
			const parsed = JSON.parse(status);

			if (parsed.status === "unlocked") {
				ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("success", "bw ✓"));
			} else if (parsed.status === "locked") {
				ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("warning", "bw 🔒"));
			} else {
				ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("error", "bw ✗"));
			}
		} catch {
			// bw not installed or not available — no status indicator
			ctx.ui.setStatus("bitwarden", undefined);
		}
	});

	// -----------------------------------------------------------------------
	// Tool: bw_search — search vault items (metadata only)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "bw_search",
		description: `Search the Bitwarden vault for items by name, URI, or folder.

Returns metadata only (name, ID, username, URIs) — never passwords or secret values.
Use bw_get_env to retrieve a secret and inject it into an environment variable.

Requires: bw CLI installed, vault unlocked (BW_SESSION set).`,
		parameters: Type.Object({
			query: Type.String({
				description: "Search term to match against item names, URIs, and usernames",
			}),
			folder: Type.Optional(
				Type.String({
					description: "Filter by folder name",
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (default: 10)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			try {
				const session = requireSession();

				onUpdate?.({
					content: [{ type: "text", text: `Searching Bitwarden for: ${params.query}...` }],
				});

				const args = ["list", "items", "--search", params.query];

				if (params.folder) {
					// Resolve folder ID first
					const foldersRaw = await runBw(["list", "folders"], session);
					const folders = JSON.parse(foldersRaw) as Array<{ id: string; name: string }>;
					const match = folders.find(
						(f) => f.name.toLowerCase() === params.folder!.toLowerCase(),
					);
					if (match) {
						args.push("--folderid", match.id);
					} else {
						return textResult(
							`No folder named "${params.folder}" found. Available folders: ${folders.map((f) => f.name).join(", ")}`,
						);
					}
				}

				const raw = await runBw(args, session);
				const items = JSON.parse(raw) as VaultItem[];

				const limit = Math.min(params.limit ?? 10, 50);
				const limited = items.slice(0, limit);

				if (limited.length === 0) {
					return textResult(`No items found matching "${params.query}".`);
				}

				const header =
					items.length > limit
						? `Found ${items.length} items (showing first ${limit}):\n\n`
						: `Found ${limited.length} item(s):\n\n`;

				const body = limited.map((item, i) => formatItemSummary(item, i)).join("\n\n");

				return textResult(
					header +
						body +
						"\n\n---\n" +
						"Use `bw_get_env` with an item ID to securely inject a secret into an environment variable.",
				);
			} catch (e) {
				return handleCommonErrors(e);
			}
		},
	});

	// -----------------------------------------------------------------------
	// Tool: bw_get_env — retrieve secret → inject into env var (preferred)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "bw_get_env",
		description: `Retrieve a secret from Bitwarden and inject it into an environment variable.

This is the PREFERRED way to use secrets — the value is set in the process
environment and never appears in the conversation. After calling this tool,
the secret is available via the environment variable name you specify.

Fields you can retrieve: password, username, totp, notes, or a custom field name.

Requires user confirmation before every retrieval.`,
		parameters: Type.Object({
			item_id: Type.String({
				description: "The Bitwarden item ID (from bw_search results)",
			}),
			field: Type.Optional(
				Type.String({
					description:
						'Which field to retrieve: "password" (default), "username", "totp", "notes", or a custom field name',
				}),
			),
			env_var: Type.String({
				description:
					"Name of the environment variable to set (e.g. DATABASE_PASSWORD, API_KEY)",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const session = requireSession();
				const field = params.field ?? "password";

				// Fetch item name for the confirmation prompt
				let itemName = params.item_id;
				try {
					const itemRaw = await runBw(["get", "item", params.item_id], session);
					const item = JSON.parse(itemRaw);
					itemName = item.name ?? params.item_id;
				} catch {
					// Fall back to showing the ID
				}

				// Require explicit user confirmation
				if (ctx.hasUI) {
					const choice = await ctx.ui.select(
						`🔐 Bitwarden: retrieve "${field}" from "${itemName}" → $${params.env_var}?\n\n` +
							"The secret will be set as an environment variable (not shown in chat).",
						["Allow", "Deny"],
					);

					if (choice !== "Allow") {
						return textResult("Secret retrieval denied by user.");
					}
				} else {
					// No UI — block for safety
					return errorResult(
						"Cannot retrieve secrets without UI for confirmation. " +
							"Run in interactive mode.",
					);
				}

				// Retrieve the secret value
				let secret: string;

				if (field === "password" || field === "username" || field === "totp" || field === "notes") {
					secret = await runBw(["get", field, params.item_id], session);
				} else {
					// Custom field
					secret = await runBw(["get", "item", params.item_id, "--field", field], session);
				}

				if (!secret) {
					return errorResult(`Field "${field}" is empty for item "${itemName}".`);
				}

				// Inject into environment — secret never enters conversation
				process.env[params.env_var] = secret;

				return textResult(
					`Secret injected into environment variable \`$${params.env_var}\`.\n` +
						`Source: "${itemName}" (field: ${field})\n\n` +
						"The value is available in the process environment. " +
						"Use it in bash commands via `$" +
						params.env_var +
						"`.",
				);
			} catch (e) {
				return handleCommonErrors(e);
			}
		},
	});

	// -----------------------------------------------------------------------
	// Tool: bw_get_note — retrieve a secure note's content
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "bw_get_note",
		description: `Retrieve the contents of a Bitwarden Secure Note.

Unlike passwords, secure notes often contain non-sensitive reference data
(configs, instructions, templates). Still requires user confirmation.

Use bw_get_env instead if the note contains a secret that should go into an env var.`,
		parameters: Type.Object({
			item_id: Type.String({
				description: "The Bitwarden item ID (from bw_search results)",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				const session = requireSession();

				// Fetch item details
				const itemRaw = await runBw(["get", "item", params.item_id], session);
				const item = JSON.parse(itemRaw) as VaultItem;

				if (item.type !== 2) {
					return errorResult(
						`Item "${item.name}" is not a Secure Note (type: ${TYPE_LABELS[item.type] ?? item.type}). ` +
							"Use bw_get_env for login credentials.",
					);
				}

				// Require confirmation
				if (ctx.hasUI) {
					const choice = await ctx.ui.select(
						`📄 Bitwarden: retrieve secure note "${item.name}"?\n\n` +
							"The note contents will appear in the conversation.",
						["Allow", "Deny"],
					);

					if (choice !== "Allow") {
						return textResult("Note retrieval denied by user.");
					}
				} else {
					return errorResult("Cannot retrieve notes without UI for confirmation.");
				}

				const notes = await runBw(["get", "notes", params.item_id], session);

				if (!notes) {
					return textResult(`Secure note "${item.name}" is empty.`);
				}

				return textResult(`**${item.name}** (Secure Note):\n\n${notes}`);
			} catch (e) {
				return handleCommonErrors(e);
			}
		},
	});
}

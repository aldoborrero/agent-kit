/**
 * Bitwarden CLI Extension
 *
 * Secure access to Bitwarden vault items via the `bw` CLI.
 *
 * Security design:
 *   - Session tokens kept in process.env, never exposed to LLM
 *   - Passwords masked by default, require explicit user confirmation
 *   - Read-only vault access (get/list only)
 *   - Auto-lock on session shutdown
 *   - No master password handling (interactive unlock only)
 *
 * Requirements:
 *   - bw CLI installed and in PATH
 *   - bw login completed before session start
 */

import { execSync, spawn } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const SESSION_ENV_KEY = "BW_SESSION";
const MASKED = "********";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface BwItem {
  id: string;
  name: string;
  type: number; // 1=login, 2=secureNote, 3=card, 4=identity
  folderId?: string;
  login?: {
    username?: string;
    password?: string;
    totp?: string;
    uris?: { uri: string }[];
  };
  notes?: string;
  fields?: { name: string; value: string; type: number }[];
  card?: {
    cardholderName?: string;
    brand?: string;
    number?: string;
    expMonth?: string;
    expYear?: string;
    code?: string;
  };
  identity?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
}

function getSession(): string | undefined {
  return process.env[SESSION_ENV_KEY];
}

function runBw(args: string[]): Promise<string> {
  const session = getSession();
  const fullArgs = session ? [...args, "--session", session] : args;

  return new Promise((resolve, reject) => {
    const child = spawn("bw", fullArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
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

function getVaultStatus(): "locked" | "unlocked" | "unauthenticated" | "unknown" {
  try {
    const output = execSync("bw status", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    const status = JSON.parse(output);
    return status.status ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isAvailable(): boolean {
  try {
    execSync("bw --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Strip sensitive fields from an item, replacing with masked values. */
function sanitizeItem(item: BwItem, expose: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: item.id,
    name: item.name,
    type: ["unknown", "login", "secureNote", "card", "identity"][item.type] ?? "unknown",
  };

  if (item.folderId) {
    result.folderId = item.folderId;
  }

  if (item.login) {
    result.login = {
      username: item.login.username ?? null,
      password: expose ? item.login.password : MASKED,
      totp: expose ? (item.login.totp ? "present" : null) : MASKED,
      uris: item.login.uris?.map((u) => u.uri) ?? [],
    };
  }

  if (item.card) {
    result.card = {
      cardholderName: item.card.cardholderName ?? null,
      brand: item.card.brand ?? null,
      number: expose ? item.card.number : MASKED,
      expMonth: item.card.expMonth ?? null,
      expYear: item.card.expYear ?? null,
      code: expose ? item.card.code : MASKED,
    };
  }

  if (item.identity) {
    result.identity = {
      firstName: item.identity.firstName ?? null,
      lastName: item.identity.lastName ?? null,
      email: item.identity.email ?? null,
      phone: item.identity.phone ?? null,
    };
  }

  // Custom fields: mask hidden fields unless exposed
  if (item.fields && item.fields.length > 0) {
    result.fields = item.fields.map((f) => ({
      name: f.name,
      value: f.type === 1 /* hidden */ && !expose ? MASKED : f.value,
      type: ["text", "hidden", "boolean"][f.type] ?? "unknown",
    }));
  }

  // Notes: include presence indicator but not content unless exposed
  if (item.notes) {
    result.notes = expose ? item.notes : "(has notes - use expose:true to view)";
  }

  return result;
}

function formatItemSummary(item: BwItem): string {
  const parts = [item.name];
  if (item.login?.username) {
    parts.push(`(${item.login.username})`);
  }
  if (item.login?.uris?.[0]) {
    parts.push(`- ${item.login.uris[0].uri}`);
  }
  return parts.join(" ");
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let vaultStatus: string = "unknown";

  function updateStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    if (vaultStatus === "unlocked") {
      ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("success", "bw:unlocked"));
    } else if (vaultStatus === "locked") {
      ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("warning", "bw:locked"));
    } else if (vaultStatus === "unauthenticated") {
      ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("error", "bw:logged-out"));
    } else {
      ctx.ui.setStatus("bitwarden", undefined);
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  pi.registerCommand("bw", {
    description: "Bitwarden vault: /bw [unlock|lock|sync|status]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;

      const arg = args.trim().toLowerCase();

      if (arg === "unlock") {
        const status = getVaultStatus();

        if (status === "unauthenticated") {
          ctx.ui.notify(
            "Not logged in to Bitwarden. Run `bw login` in your terminal first.",
            "error",
          );
          return;
        }

        if (status === "unlocked") {
          ctx.ui.notify("Vault is already unlocked.", "info");
          return;
        }

        // Prompt for master password securely
        const password = await ctx.ui.prompt("Enter Bitwarden master password:", {
          secret: true,
        });

        if (!password) {
          ctx.ui.notify("Unlock cancelled.", "info");
          return;
        }

        try {
          // bw unlock outputs the session key
          const output = execSync(
            `bw unlock --raw`,
            {
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              input: password,
              timeout: 30_000,
            },
          );

          const sessionToken = output.trim();
          if (sessionToken) {
            process.env[SESSION_ENV_KEY] = sessionToken;
            vaultStatus = "unlocked";
            updateStatus(ctx);
            ctx.ui.notify("Vault unlocked.", "info");
          }
        } catch (err) {
          ctx.ui.notify(
            `Unlock failed: ${err instanceof Error ? err.message : err}`,
            "error",
          );
        }
        return;
      }

      if (arg === "lock") {
        try {
          await runBw(["lock"]);
          delete process.env[SESSION_ENV_KEY];
          vaultStatus = "locked";
          updateStatus(ctx);
          ctx.ui.notify("Vault locked.", "info");
        } catch (err) {
          ctx.ui.notify(
            `Lock failed: ${err instanceof Error ? err.message : err}`,
            "error",
          );
        }
        return;
      }

      if (arg === "sync") {
        try {
          await runBw(["sync"]);
          ctx.ui.notify("Vault synced.", "info");
        } catch (err) {
          ctx.ui.notify(
            `Sync failed: ${err instanceof Error ? err.message : err}`,
            "error",
          );
        }
        return;
      }

      // Default: show status
      vaultStatus = getVaultStatus();
      updateStatus(ctx);

      const lines = [
        `Bitwarden vault: ${vaultStatus}`,
        "",
        "Commands:",
        "  /bw unlock  - Unlock vault",
        "  /bw lock    - Lock vault",
        "  /bw sync    - Sync with server",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Tools ─────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "bw_get",
    description: `Retrieve a Bitwarden vault item by name, ID, or URI.

Returns item metadata (name, username, URIs). Passwords are masked by default.
Set expose=true to reveal sensitive fields (requires user confirmation).

The vault must be unlocked first (use /bw unlock command).`,
    parameters: Type.Object({
      query: Type.String({
        description: "Item name, UUID, or URI to search for",
      }),
      expose: Type.Optional(
        Type.Boolean({
          description:
            "If true, include password/TOTP/card number fields (requires user confirmation). Default: false.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isAvailable()) {
        return {
          content: [
            {
              type: "text",
              text: "Bitwarden CLI (bw) is not installed or not in PATH. Install from https://bitwarden.com/help/cli/",
            },
          ],
          isError: true,
        };
      }

      const status = getVaultStatus();
      if (status !== "unlocked") {
        return {
          content: [
            {
              type: "text",
              text: `Vault is ${status}. Use /bw unlock to unlock it first.`,
            },
          ],
          isError: true,
        };
      }

      const wantsExpose = params.expose === true;

      // If exposing sensitive data, require user confirmation
      if (wantsExpose && ctx.hasUI) {
        const choice = await ctx.ui.select(
          `Expose sensitive fields for query "${params.query}"?\n\nThis will reveal passwords, TOTP secrets, and card numbers to the agent.`,
          ["Yes, expose this time", "No, keep masked"],
        );

        if (choice !== "Yes, expose this time") {
          return {
            content: [
              {
                type: "text",
                text: "User denied access to sensitive fields. Item returned with masked values.",
              },
            ],
          };
        }
      }

      try {
        const output = await runBw(["get", "item", params.query]);
        const item: BwItem = JSON.parse(output);
        const sanitized = sanitizeItem(item, wantsExpose);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(sanitized, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes("Not found")) {
          return {
            content: [
              {
                type: "text",
                text: `No item found matching "${params.query}".`,
              },
            ],
            isError: true,
          };
        }

        if (msg.includes("More than one")) {
          // Multiple matches - list them
          try {
            const listOutput = await runBw([
              "list",
              "items",
              "--search",
              params.query,
            ]);
            const items: BwItem[] = JSON.parse(listOutput);
            const summaries = items
              .slice(0, 10)
              .map((i) => `- ${formatItemSummary(i)} (id: ${i.id})`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Multiple items match "${params.query}". Use a more specific query or an item ID:\n\n${summaries}`,
                },
              ],
              isError: true,
            };
          } catch {
            return {
              content: [
                {
                  type: "text",
                  text: `Multiple items match "${params.query}". Use a more specific name or the item's UUID.`,
                },
              ],
              isError: true,
            };
          }
        }

        return {
          content: [{ type: "text", text: `Bitwarden error: ${msg}` }],
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "bw_list",
    description: `List Bitwarden vault items matching a search query.

Returns item summaries (name, username, URIs) without any sensitive fields.
Use bw_get with a specific item name or ID to retrieve full details.

The vault must be unlocked first (use /bw unlock command).`,
    parameters: Type.Object({
      search: Type.Optional(
        Type.String({ description: "Search term to filter items" }),
      ),
      folder: Type.Optional(
        Type.String({ description: "Filter by folder name" }),
      ),
      collection: Type.Optional(
        Type.String({ description: "Filter by collection name" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!isAvailable()) {
        return {
          content: [
            {
              type: "text",
              text: "Bitwarden CLI (bw) is not installed or not in PATH.",
            },
          ],
          isError: true,
        };
      }

      const status = getVaultStatus();
      if (status !== "unlocked") {
        return {
          content: [
            {
              type: "text",
              text: `Vault is ${status}. Use /bw unlock to unlock it first.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const args = ["list", "items"];

        if (params.search) {
          args.push("--search", params.search);
        }

        if (params.folder) {
          // Resolve folder name to ID
          const foldersOutput = await runBw(["list", "folders"]);
          const folders = JSON.parse(foldersOutput) as {
            id: string;
            name: string;
          }[];
          const folder = folders.find(
            (f) => f.name.toLowerCase() === params.folder!.toLowerCase(),
          );
          if (folder) {
            args.push("--folderid", folder.id);
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Folder "${params.folder}" not found. Available folders: ${folders.map((f) => f.name).join(", ")}`,
                },
              ],
              isError: true,
            };
          }
        }

        if (params.collection) {
          const collectionsOutput = await runBw(["list", "collections"]);
          const collections = JSON.parse(collectionsOutput) as {
            id: string;
            name: string;
          }[];
          const collection = collections.find(
            (c) =>
              c.name.toLowerCase() === params.collection!.toLowerCase(),
          );
          if (collection) {
            args.push("--collectionid", collection.id);
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `Collection "${params.collection}" not found.`,
                },
              ],
              isError: true,
            };
          }
        }

        const output = await runBw(args);
        const items: BwItem[] = JSON.parse(output);

        if (items.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No items found matching your criteria.",
              },
            ],
          };
        }

        const lines = [
          `Found ${items.length} item(s):`,
          "",
          ...items.slice(0, 50).map(
            (item, i) =>
              `${i + 1}. ${formatItemSummary(item)}`,
          ),
        ];

        if (items.length > 50) {
          lines.push(`\n... and ${items.length - 50} more. Refine your search.`);
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Bitwarden error: ${msg}` }],
          isError: true,
        };
      }
    },
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (!isAvailable()) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("error", "bw:missing"));
      }
      return;
    }

    vaultStatus = getVaultStatus();
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async () => {
    // Auto-lock vault and clear session token on shutdown
    if (getSession()) {
      try {
        execSync("bw lock", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10_000,
        });
      } catch {
        // Best-effort lock
      }
      delete process.env[SESSION_ENV_KEY];
    }
  });

  // ── Safety: block bw commands in bash ──────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;

    // Block direct bw CLI usage in bash to prevent session token leakage
    if (/\bbw\s+(get|list|unlock|login|sync|export|encode|create|edit|delete|restore|move|confirm|share|send)\b/.test(command)) {
      return {
        block: true,
        reason:
          "Direct bw CLI access is blocked for security. Use the bw_get and bw_list tools instead, which handle session tokens securely and mask sensitive data.",
      };
    }

    return undefined;
  });
}

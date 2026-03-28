/**
 * Bitwarden Extension (via rbw)
 *
 * Secure access to Bitwarden vault items via rbw (unofficial Bitwarden CLI).
 * rbw uses a background agent (rbw-agent) to hold decryption keys in memory,
 * eliminating the need for session token management.
 *
 * Security design:
 *   - No session tokens or secrets in process.env
 *   - Passwords masked by default, require explicit user confirmation to expose
 *   - Read-only vault access (get/list only)
 *   - rbw-agent handles key lifecycle independently
 *
 * Requirements:
 *   - rbw installed and in PATH (https://github.com/doy/rbw)
 *   - rbw configured: `rbw config set email <email>`
 *   - rbw registered: `rbw register` (once per device)
 */

import { execSync, spawn } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const MASKED = "********";

// ── Helpers ──────────────────────────────────────────────────────────────────

function runRbw(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("rbw", args, {
      stdio: ["pipe", "pipe", "pipe"],
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
        reject(new Error(stderr.trim() || `rbw exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

function isAvailable(): boolean {
  try {
    execSync("rbw --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function isUnlocked(): boolean {
  try {
    execSync("rbw unlocked", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  function updateStatus(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    if (!isAvailable()) {
      ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("error", "rbw:missing"));
      return;
    }

    if (isUnlocked()) {
      ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("success", "rbw:unlocked"));
    } else {
      ctx.ui.setStatus("bitwarden", ctx.ui.theme.fg("warning", "rbw:locked"));
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  pi.registerCommand("bw", {
    description: "Bitwarden vault: /bw [unlock|lock|sync|status]",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;

      if (!isAvailable()) {
        ctx.ui.notify(
          "rbw is not installed. Install from https://github.com/doy/rbw",
          "error",
        );
        return;
      }

      const arg = args.trim().toLowerCase();

      if (arg === "unlock") {
        if (isUnlocked()) {
          ctx.ui.notify("Vault is already unlocked.", "info");
          return;
        }

        try {
          // rbw unlock prompts for master password via pinentry/agent
          await runRbw(["unlock"]);
          updateStatus(ctx);
          ctx.ui.notify("Vault unlocked.", "info");
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
          await runRbw(["lock"]);
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
          await runRbw(["sync"]);
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
      updateStatus(ctx);
      const status = isUnlocked() ? "unlocked" : "locked";
      const lines = [
        `Bitwarden vault: ${status}`,
        "",
        "Commands:",
        "  /bw unlock  - Unlock vault (via rbw-agent pinentry)",
        "  /bw lock    - Lock vault",
        "  /bw sync    - Sync with server",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Tools ─────────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "bw_get",
    description: `Retrieve a Bitwarden vault item by name or folder/name.

By default returns only the username. Set field to retrieve a specific field.
Sensitive fields (password, totp, notes) require user confirmation.

The vault must be unlocked first (use /bw unlock command).

Examples:
  bw_get(name: "github.com") -> returns username
  bw_get(name: "github.com", field: "password") -> returns password (with confirmation)
  bw_get(name: "GitHub", folder: "Work") -> returns username from Work folder
  bw_get(name: "AWS", field: "totp") -> returns TOTP code (with confirmation)`,
    parameters: Type.Object({
      name: Type.String({
        description: "Item name or URI to search for",
      }),
      folder: Type.Optional(
        Type.String({
          description: "Folder name to narrow the search (for duplicate item names)",
        }),
      ),
      field: Type.Optional(
        Type.String({
          description:
            "Specific field to retrieve: 'username', 'password', 'totp', 'notes', or a custom field name. Default: 'username'.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isAvailable()) {
        return {
          content: [{
            type: "text",
            text: "rbw is not installed. Install from https://github.com/doy/rbw",
          }],
          isError: true,
        };
      }

      if (!isUnlocked()) {
        return {
          content: [{
            type: "text",
            text: "Vault is locked. Use /bw unlock to unlock it first.",
          }],
          isError: true,
        };
      }

      const field = params.field ?? "username";
      const sensitiveFields = ["password", "totp", "notes"];
      const isSensitive = sensitiveFields.includes(field.toLowerCase());

      // Require user confirmation for sensitive fields
      if (isSensitive && ctx.hasUI) {
        const choice = await ctx.ui.select(
          `Expose "${field}" for "${params.name}"?\n\nThis will reveal the ${field} to the agent.`,
          ["Yes, expose this time", "No, deny access"],
        );

        if (choice !== "Yes, expose this time") {
          return {
            content: [{
              type: "text",
              text: `User denied access to "${field}" field.`,
            }],
          };
        }
      }

      try {
        const args = ["get"];

        // For password (default rbw get behavior) vs specific fields
        if (field === "password") {
          args.push(params.name);
        } else if (field === "username") {
          args.push("--full", params.name);
        } else if (field === "totp") {
          // rbw code generates TOTP
          const codeArgs = ["code", params.name];
          if (params.folder) {
            codeArgs.push("--folder", params.folder);
          }
          const code = await runRbw(codeArgs);
          return {
            content: [{ type: "text", text: `TOTP code: ${code}` }],
          };
        } else if (field === "notes") {
          args.push("--full", params.name);
        } else {
          // Custom field
          args.push("--field", field, params.name);
        }

        if (params.folder) {
          args.push("--folder", params.folder);
        }

        const output = await runRbw(args);

        if (field === "username" || field === "notes") {
          // --full output format: "password\nusername: value\nURI: value\nNotes:\nline1\nline2"
          const lines = output.split("\n");

          if (field === "username") {
            const userLine = lines.find((l) => l.startsWith("Username: "));
            const username = userLine
              ? userLine.replace("Username: ", "")
              : "(no username)";

            // Also extract URIs for context
            const uris = lines
              .filter((l) => l.startsWith("URI: "))
              .map((l) => l.replace("URI: ", ""));

            const parts = [`Username: ${username}`];
            if (uris.length > 0) {
              parts.push(`URIs: ${uris.join(", ")}`);
            }
            parts.push(`Password: ${MASKED}`);

            return {
              content: [{ type: "text", text: parts.join("\n") }],
            };
          }

          if (field === "notes") {
            const notesIdx = lines.findIndex((l) => l === "Notes:");
            if (notesIdx === -1) {
              return {
                content: [{ type: "text", text: "(no notes)" }],
              };
            }
            const notes = lines.slice(notesIdx + 1).join("\n");
            return {
              content: [{ type: "text", text: notes || "(empty notes)" }],
            };
          }
        }

        // For password and custom fields, output is the raw value
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `rbw error: ${msg}` }],
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "bw_list",
    description: `List Bitwarden vault items, optionally filtered by a search term.

Returns item names only (no sensitive data). Use bw_get to retrieve specific fields.

The vault must be unlocked first (use /bw unlock command).`,
    parameters: Type.Object({
      search: Type.Optional(
        Type.String({ description: "Search term to filter items (case-insensitive substring match)" }),
      ),
      folder: Type.Optional(
        Type.String({ description: "Filter by folder name" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!isAvailable()) {
        return {
          content: [{
            type: "text",
            text: "rbw is not installed. Install from https://github.com/doy/rbw",
          }],
          isError: true,
        };
      }

      if (!isUnlocked()) {
        return {
          content: [{
            type: "text",
            text: "Vault is locked. Use /bw unlock to unlock it first.",
          }],
          isError: true,
        };
      }

      try {
        const args = ["list"];

        if (params.folder) {
          args.push("--fields", "name,user,folder");
        } else {
          args.push("--fields", "name,user,folder");
        }

        const output = await runRbw(args);
        let lines = output.split("\n").filter((l) => l.trim());

        // Apply folder filter
        if (params.folder) {
          const folderLower = params.folder.toLowerCase();
          lines = lines.filter((line) => {
            const parts = line.split("\t");
            const folder = parts[2]?.trim().toLowerCase() ?? "";
            return folder === folderLower;
          });
        }

        // Apply search filter
        if (params.search) {
          const searchLower = params.search.toLowerCase();
          lines = lines.filter((line) => line.toLowerCase().includes(searchLower));
        }

        if (lines.length === 0) {
          return {
            content: [{ type: "text", text: "No items found matching your criteria." }],
          };
        }

        // Format output
        const formatted = lines.slice(0, 50).map((line, i) => {
          const parts = line.split("\t");
          const name = parts[0] ?? "";
          const user = parts[1] ?? "";
          const folder = parts[2] ?? "";
          const display = user ? `${name} (${user})` : name;
          return folder
            ? `${i + 1}. ${display} [${folder}]`
            : `${i + 1}. ${display}`;
        });

        const header = `Found ${lines.length} item(s):`;
        const result = [header, "", ...formatted];

        if (lines.length > 50) {
          result.push(`\n... and ${lines.length - 50} more. Refine your search.`);
        }

        return {
          content: [{ type: "text", text: result.join("\n") }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `rbw error: ${msg}` }],
          isError: true,
        };
      }
    },
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);
  });

  // ── Safety: block direct rbw/bw usage in bash ─────────────────────────────

  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;

    // Block direct rbw/bw CLI access to prevent secrets appearing in tool results
    if (/\brbw\s+(get|code)\b/.test(command)) {
      return {
        block: true,
        reason:
          "Direct rbw credential access in bash is blocked. Use the bw_get tool instead, which masks sensitive fields and requires user confirmation.",
      };
    }

    if (/\bbw\s+(get|list|unlock|login|export)\b/.test(command)) {
      return {
        block: true,
        reason:
          "Direct bw CLI access is blocked. Use the bw_get and bw_list tools instead.",
      };
    }

    return undefined;
  });
}

/**
 * Direnv Extension
 *
 * Loads direnv environment variables on session start and after each bash
 * command. This mimics how the shell hook works - it runs after every command
 * to pick up any .envrc changes from cd, git checkout, etc.
 *
 * Requirements:
 *   - direnv installed and in PATH
 *   - .envrc must be allowed (run `direnv allow` in your shell first)
 */

import { execSync } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { registerFancyFooterWidget, refreshFancyFooter } from "../_shared/fancy-footer.js";
import { createUiColors } from "../_shared/ui-colors.js";

export default function (pi: ExtensionAPI) {
  let fancyFooterActive = false;
  let direnvStatus: "on" | "blocked" | "error" | "off" = "off";
  const fancyFooterReady = registerFancyFooterWidget(pi, () => ({
    id: "pi-agent-kit.direnv",
    label: "Direnv",
    description: "Shows whether direnv loaded successfully or is blocked for the current session.",
    defaults: {
      row: 1,
      position: 15,
      align: "right",
      fill: "none",
    },
    textColor: direnvStatus === "error" ? "error" : "warning",
    visible: () => direnvStatus === "blocked" || direnvStatus === "error",
    renderText: () => `direnv:${direnvStatus}`,
  })).then((active) => {
    fancyFooterActive = active;
    return active;
  });

  function updateStatus(ctx: ExtensionContext, status: "on" | "blocked" | "error" | "off"): void {
    direnvStatus = status;
    if (fancyFooterActive) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("direnv", undefined);
      }
      void refreshFancyFooter(pi);
      return;
    }
    if (!ctx.hasUI) return;
    if (status === "off" || status === "on") {
      ctx.ui.setStatus("direnv", undefined);
      return;
    }
    const colors = createUiColors(ctx.ui.theme);
    const text = status === "blocked"
      ? colors.warning("direnv:blocked")
      : colors.danger("direnv:error");
    ctx.ui.setStatus("direnv", text);
  }

  function loadDirenv(cwd: string, ctx: ExtensionContext) {
    try {
      const output = execSync("direnv export json", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (!output.trim()) {
        updateStatus(ctx, "off");
        return;
      }

      const env = JSON.parse(output);
      let loadedCount = 0;
      for (const [key, value] of Object.entries(env)) {
        if (value === null) {
          delete process.env[key];
        } else {
          process.env[key] = value as string;
          loadedCount++;
        }
      }

      updateStatus(ctx, loadedCount > 0 ? "on" : "off");
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      updateStatus(ctx, /allow|blocked|denied|not allowed/.test(message) ? "blocked" : "error");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await fancyFooterReady;
    loadDirenv(ctx.cwd, ctx);
  });

  // Run direnv after every bash command to pick up .envrc changes
  // This handles: cd to new dir, git checkout, direnv allow, etc.
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    loadDirenv(ctx.cwd, ctx);
  });

  pi.registerCommand("direnv", {
    description: "Reload direnv environment variables",
    handler: async (_args, ctx) => {
      loadDirenv(ctx.cwd, ctx);
      ctx.ui.notify("direnv reloaded", "info");
    },
  });
}

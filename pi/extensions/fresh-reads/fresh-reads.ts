/**
 * Fresh Read Guard Extension
 * 
 * Prevents stale file edits by ensuring files are re-read before modification
 * if they have changed since the last read operation.
 * 
 * @version 1.0.0
 * @author Ken Taylor
 * @see https://github.com/ktappdev
 * @see https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const fs = require("fs/promises");
const path = require("path");

interface FileRecord {
  /** Timestamp of last successful read by agent (ms epoch) */
  lastRead: number;
  /** Timestamp of last successful edit by agent (ms epoch) */
  lastEdit: number | null;
  /** Filesystem mtime at time of last read (ms epoch) */
  mtime: number;
}

interface FreshReadConfig {
  enabled: boolean;
  autoReread: boolean;
  protectedPaths: string[];
  ignoredPaths: string[];
}

export default function (pi: ExtensionAPI) {
  // Session-scoped file tracking
  let fileMap: Map<string, FileRecord> | null = null;
  
  // Track files currently being re-read (prevent loops)
  const reReadInProgress = new Set<string>();
  
  // Track files currently being edited (prevent race conditions)
  const editLocks = new Set<string>();
  
  // Configuration
  let config: FreshReadConfig = {
    enabled: true,
    autoReread: true,
    protectedPaths: [],
    ignoredPaths: [],
  };

  /**
   * Load configuration from file
   */
  async function loadConfig(): Promise<void> {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (!homeDir) {
      // console.log("[fresh-read] HOME not set, using default configuration");
      return;
    }

    const configPath = path.join(homeDir, ".pi/agent/extensions/fresh-read.config.json");

    try {
      const configContent = await fs.readFile(configPath, "utf-8");
      const loaded = JSON.parse(configContent);
      config = { ...config, ...loaded };
      // console.log("[fresh-read] Configuration loaded from", configPath);
    } catch (error) {
      // Config file doesn't exist or is invalid, use defaults
      // console.log("[fresh-read] Using default configuration");
    }
  }

  /**
   * Check if a file path should be ignored
   */
  function shouldIgnore(filePath: string): boolean {
    if (config.ignoredPaths.length === 0) return false;
    
    // Simple glob matching (can be enhanced with micromatch if needed)
    for (const pattern of config.ignoredPaths) {
      if (pattern.startsWith("**/")) {
        // Match any directory depth
        const suffix = pattern.slice(3);
        if (filePath.endsWith(suffix)) return true;
      } else if (pattern.endsWith("/**")) {
        // Match directory and all children
        const prefix = pattern.slice(0, -3);
        if (filePath.startsWith(prefix)) return true;
      } else if (filePath.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Resolve a path to absolute form
   */
  function resolvePath(inputPath: string, cwd: string): string {
    const resolved = path.isAbsolute(inputPath) 
      ? inputPath 
      : path.join(cwd, inputPath);
    return path.normalize(resolved);
  }

  /**
   * Check if a file exists
   */
  async function fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a file is stale (modified since last read)
   */
  async function isFileStale(
    filePath: string, 
    map: Map<string, FileRecord>
  ): Promise<boolean> {
    const record = map.get(filePath);
    
    // Never read before = stale
    if (!record) {
      return true;
    }

    try {
      const stats = await fs.stat(filePath);
      const currentMtime = stats.mtimeMs;
      
      // File changed on disk since last read = stale
      // Add 1ms buffer to handle filesystem mtime precision differences
      return currentMtime > record.mtime + 1;
    } catch (error) {
      // File no longer accessible = treat as stale
      // console.log(`[fresh-read] Cannot stat ${filePath}, treating as stale`);
      return true;
    }
  }

  /**
   * Record a successful read operation
   */
  async function recordRead(
    filePath: string, 
    map: Map<string, FileRecord>
  ): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      const mtime = stats.mtimeMs;
      
      map.set(filePath, {
        lastRead: Date.now(),
        lastEdit: map.get(filePath)?.lastEdit ?? null,
        mtime,
      });
    } catch (error) {
      // console.log(`[fresh-read] Failed to record read for ${filePath}:`, error);
    }
  }

  /**
   * Record a successful edit operation
   */
  async function recordEdit(
    filePath: string, 
    map: Map<string, FileRecord>
  ): Promise<void> {
    const existing = map.get(filePath);
    
    map.set(filePath, {
      lastRead: existing?.lastRead ?? Date.now(),
      lastEdit: Date.now(),
      mtime: existing?.mtime ?? 0,
    });
  }

  /**
   * Initialize extension
   */
  async function init(): Promise<void> {
    await loadConfig();
    // console.log("[fresh-read] Extension initialized");
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle: Session Start
  // ─────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    fileMap = new Map();
    reReadInProgress.clear();
    // console.log("[fresh-read] Session started, file tracking initialized");
  });

  // ─────────────────────────────────────────────────────────
  // Lifecycle: Session End
  // ─────────────────────────────────────────────────────────
  pi.on("session_end", async () => {
    fileMap = null;
    reReadInProgress.clear();
    editLocks.clear();
    // console.log("[fresh-read] Session ended, file tracking cleared");
  });

  // ─────────────────────────────────────────────────────────
  // Hook: Pre-flight Tool Call Check
  // ─────────────────────────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (!config.enabled) return;
    if (!fileMap) return; // Session not initialized

    const { toolName, input } = event;

    // Only intercept edit/write tools
    if (toolName !== "edit" && toolName !== "write") {
      return;
    }

    // Guard against missing path
    if (!input.path) {
      // console.log("[fresh-read] Missing path in tool input, skipping");
      return;
    }

    const filePath = resolvePath(input.path, ctx.sessionManager.cwd);

    // Check if path should be ignored
    if (shouldIgnore(filePath)) {
      // console.log(`[fresh-read] ${filePath} is in ignored paths, skipping`);
      return;
    }

    // Skip if file doesn't exist (new file write)
    const exists = await fileExists(filePath);
    if (!exists) {
      // console.log(`[fresh-read] ${filePath} does not exist, skipping freshness check`);
      return;
    }

    // Check if another edit is already in progress (race condition prevention)
    if (editLocks.has(filePath)) {
      // console.log(`[fresh-read] ${filePath} is locked by another edit, blocking`);
      return { block: true, reason: "Another edit operation in progress for this file" };
    }

    // Check if file is stale
    const stale = await isFileStale(filePath, fileMap);

    if (stale) {
      // console.log(`[fresh-read] ${filePath} is stale, blocking ${toolName}`);
      
      // Notify user
      ctx.ui.notify("File was modified externally. Re-reading...", "info");
      ctx.ui.setStatus("🔄 Re-reading file...");

      // Auto re-read if enabled
      if (config.autoReread) {
        // Prevent re-read loops
        if (reReadInProgress.has(filePath)) {
          ctx.ui.setStatus("⚠️ Re-read loop detected, proceeding with edit");
          // console.log(`[fresh-read] Re-read loop detected for ${filePath}`);
          return; // Allow the edit to proceed
        }

        // Mark as in-progress
        reReadInProgress.add(filePath);

        // Trigger re-read
        try {
          // Check if ctx.tools.read is available
          if (typeof ctx.tools?.read !== 'function') {
            ctx.ui.notify("Auto re-read not supported in this Pi version", "error");
            return { block: true, reason: "Cannot auto re-read" };
          }

          await ctx.tools.read({ path: filePath });
          // console.log(`[fresh-read] Re-read successful for ${filePath}`);
          ctx.ui.notify("File re-read complete", "info");
        } catch (error) {
          ctx.ui.notify(`Failed to re-read ${filePath}`, "error");
          ctx.ui.setStatus("⚠️ Re-read failed");
          // console.log(`[fresh-read] Re-read failed for ${filePath}:`, error);
        } finally {
          reReadInProgress.delete(filePath);
          ctx.ui.setStatus("");
        }
      } else {
        // Manual mode - just notify and block
        ctx.ui.notify(`File ${filePath} was modified. Please read it again.`, "warning");
      }

      // Block the original edit
      return {
        block: true,
        reason: "File was modified externally. Re-read completed, please retry edit."
      };
    }

    // File is fresh, lock it for editing
    editLocks.add(filePath);
    // console.log(`[fresh-read] ${filePath} is fresh, allowing ${toolName}`);
  });

  // ─────────────────────────────────────────────────────────
  // Hook: Post-flight Tool Result Recording
  // ─────────────────────────────────────────────────────────
  pi.on("tool_result", async (event, ctx) => {
    if (!config.enabled) return;
    if (!fileMap) return;
    if (!event.result?.success) return;

    const { toolName, input } = event;
    
    // Guard against missing path
    if (!input.path) {
      return;
    }
    
    const filePath = resolvePath(input.path, ctx.sessionManager.cwd);

    if (toolName === "read") {
      await recordRead(filePath, fileMap);
      // console.log(`[fresh-read] Recorded read for ${filePath}`);
    }

    if (toolName === "edit" || toolName === "write") {
      await recordEdit(filePath, fileMap);
      // Release the edit lock
      editLocks.delete(filePath);
      // console.log(`[fresh-read] Recorded ${toolName} for ${filePath}, lock released`);
    }
  });

  // ─────────────────────────────────────────────────────────
  // Custom Command: /fresh-read-status
  // ─────────────────────────────────────────────────────────
  pi.registerCommand("fresh-read-status", {
    description: "Show fresh-read extension status and tracked files",
    handler: async (_args, ctx) => {
      if (!fileMap) {
        ctx.ui.notify("No active session", "warning");
        return;
      }

      const count = fileMap.size;
      const files = Array.from(fileMap.entries()).map(([path, record]) => {
        const age = Date.now() - record.lastRead;
        const ageSec = Math.round(age / 1000);
        return `• ${path} (read ${ageSec}s ago)`;
      }).join("\n");

      const message = `**Fresh Read Status**\n\n` +
        `Tracking ${count} file(s)\n\n` +
        (files || "No files tracked yet");

      ctx.ui.notify(message, "info");
    },
  });

  // ─────────────────────────────────────────────────────────
  // Custom Command: /fresh-read-clear
  // ─────────────────────────────────────────────────────────
  pi.registerCommand("fresh-read-clear", {
    description: "Clear fresh-read file tracking for current session",
    handler: async (_args, ctx) => {
      if (!fileMap) {
        ctx.ui.notify("No active session", "warning");
        return;
      }

      fileMap.clear();
      reReadInProgress.clear();
      editLocks.clear();
      ctx.ui.notify("Fresh read tracking cleared", "info");
      // console.log("[fresh-read] Tracking cleared via command");
    },
  });

  // Initialize on load
  init();
}

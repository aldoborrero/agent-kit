/**
 * pexpect-cli Extension
 *
 * Automate interactive CLI programs with persistent pexpect sessions
 * managed by pueue. Four tools:
 *   - pexpect_start: Create a new session
 *   - pexpect_exec: Run Python/pexpect code in a session
 *   - pexpect_stop: Terminate a session
 *   - pexpect_list: List active sessions
 *
 * Requires: pexpect-cli and pueue installed
 */

import {
  type ExtensionAPI,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execSync, spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  status: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse output from `pexpect-cli --list`. Format: "session_id: status (optional_name)" */
function parseSessionList(output: string): Session[] {
  const sessions: Session[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]+):\s*(\w+)(?:\s*\(([^)]+)\))?/i);
    if (match) {
      sessions.push({
        id: match[1],
        status: match[2],
        name: match[3],
      });
    }
  }

  return sessions;
}

/** Check if pueue daemon is running, provide helpful error if not. */
function ensurePueueRunning(): void {
  try {
    execSync("pueue status", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    throw new Error(
      "pueue daemon is not running. Start it with: pueued -d",
    );
  }
}

/** Execute pexpect-cli command synchronously and return output. */
function runPexpectCli(args: string[]): string {
  try {
    return execSync(`pexpect-cli ${args.join(" ")}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    if (e instanceof Error && "stderr" in e) {
      throw new Error((e as { stderr: string }).stderr || e.message);
    }
    throw e;
  }
}

/** Execute code in a session via stdin with optional timeout. */
function execInSession(
  sessionId: string,
  code: string,
  timeout?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pexpect-cli", [sessionId], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timeoutId: NodeJS.Timeout | undefined;

    if (timeout) {
      timeoutId = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Execution timed out after ${timeout}ms`));
      }, timeout);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (timeoutId) clearTimeout(timeoutId);

      if (code !== 0 && stderr) {
        reject(new Error(stderr));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err);
    });

    child.stdin.write(code);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

const EXEC_DESCRIPTION = `Execute Python/pexpect code in an existing session. The \`pexpect\` module is pre-imported and a \`child\` variable persists across executions within the same session.

## Core API

### Spawning a process
\`\`\`python
child = pexpect.spawn('ssh user@host')
child = pexpect.spawn('command', timeout=60)        # default timeout
child = pexpect.spawn('command', maxread=65536)      # larger buffer
\`\`\`

### Sending input
\`\`\`python
child.sendline('command')       # sends text + newline
child.send('text')              # sends text without newline (for editors, menus)
child.sendline(os.environ.get('PASSWORD', ''))  # from env var
\`\`\`

### Waiting for output
\`\`\`python
child.expect('prompt>')                    # wait for exact text
child.expect('prompt>', timeout=120)       # custom timeout
child.expect(pexpect.EOF)                  # wait for process exit
child.expect('\\$')                         # shell prompt (escape $)
child.expect('[#$]')                       # root or user prompt
\`\`\`

### Multiple expected patterns (returns index)
\`\`\`python
index = child.expect(['password:', 'Are you sure.*\\(yes/no\\)', pexpect.TIMEOUT, pexpect.EOF])
if index == 0:
    child.sendline('mypassword')
elif index == 1:
    child.sendline('yes')
    child.expect('password:')
    child.sendline('mypassword')
elif index == 2:
    print("Timed out waiting for prompt")
elif index == 3:
    print("Process exited unexpectedly")
\`\`\`

### Capturing output
\`\`\`python
child.sendline('ls -la')
child.expect('\\$')
output = child.before.decode()    # text between last match and current match
print(output)
\`\`\`

## Error handling

Always wrap pexpect operations in try/except:
\`\`\`python
try:
    child.expect('prompt>', timeout=30)
except pexpect.TIMEOUT:
    print("Timed out — process may be hung")
except pexpect.EOF:
    print("Process exited unexpectedly")
\`\`\`

## Common pitfalls

- **Forgetting timeouts**: Always pass \`timeout=N\` to \`expect()\`. Without it, a missing prompt hangs forever.
- **Wrong prompt pattern**: Use generic patterns like \`'\\$'\` or \`'[#$]'\` instead of specific prompts like \`'user@host:~$'\`.
- **Not handling EOF**: After \`sendline('exit')\`, expect \`pexpect.EOF\`, not a shell prompt.
- **Output is bytes**: Always call \`.decode()\` on \`child.before\` and \`child.after\`.
- **ANSI sequences in output**: Clean with \`re.sub(r'\\x1b\\[[0-9;]*m', '', output)\`.
- **Shell escaping**: Use raw strings or double-escape backslashes in expect patterns.

## Performance tips

- \`child.delaybeforesend = 0.01\` — reduce typing delay (default 0.05)
- Batch independent commands: \`child.sendline('cmd1; cmd2; cmd3')\`
- Use \`print()\` to return output to the agent — only printed text is captured.`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Tool 1: pexpect_start
  pi.registerTool({
    name: "pexpect_start",
    description:
      "Start a new pexpect session for automating interactive CLI programs (SSH, databases, editors, interactive shells). Returns a session ID for subsequent commands. Sessions run as pueue tasks in the `pexpect` group and persist until explicitly stopped.",
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({
          description:
            "Optional label to identify the session (e.g., 'ssh-prod', 'db-session')",
        }),
      ),
    }),
    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      try {
        ensurePueueRunning();

        const args = ["--start"];
        if (params.name) {
          args.push("--name", params.name);
        }

        const sessionId = runPexpectCli(args);

        const message = params.name
          ? `Started session \`${sessionId}\` (${params.name})`
          : `Started session \`${sessionId}\``;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text", text: `Failed to start session: ${msg}` },
          ],
          isError: true,
        };
      }
    },

    renderCall(args, theme) {
      const p = args as { name?: string };
      let text = theme.fg("toolTitle", theme.bold("pexpect ")) +
        theme.fg("accent", "start");
      if (p.name) {
        text += " " + theme.fg("muted", p.name);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const text = result.content
        ?.filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("\n") ?? "";
      return new Text(
        result.isError ? theme.fg("error", text) : theme.fg("success", text),
        0,
        0,
      );
    },
  });

  // Tool 2: pexpect_exec
  pi.registerTool({
    name: "pexpect_exec",
    description: EXEC_DESCRIPTION,
    parameters: Type.Object({
      session_id: Type.String({
        description: "The 8-character hex session ID from pexpect_start",
      }),
      code: Type.String({
        description:
          "Python code to execute. The pexpect module and child variable are available. Use print() to return output.",
      }),
      timeout: Type.Optional(
        Type.Number({
          description:
            "Execution timeout in milliseconds (default: no timeout). This is the timeout for the entire code block, not individual expect() calls.",
        }),
      ),
    }),
    async execute(_toolCallId, params, onUpdate, _ctx, _signal) {
      try {
        ensurePueueRunning();

        // Verify session exists
        const listOutput = runPexpectCli(["--list"]);
        const sessions = parseSessionList(listOutput);
        const session = sessions.find((s) => s.id === params.session_id);

        if (!session) {
          return {
            content: [
              {
                type: "text",
                text: `Session \`${params.session_id}\` not found. Use pexpect_list to see active sessions.`,
              },
            ],
            isError: true,
          };
        }

        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Executing in session \`${params.session_id}\`...`,
            },
          ],
        });

        const output = await execInSession(
          params.session_id,
          params.code,
          params.timeout,
        );

        const result = output.trim() || "(no output)";

        return {
          content: [{ type: "text", text: result }],
          details: { session_id: params.session_id },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Execution failed: ${msg}` }],
          isError: true,
        };
      }
    },

    renderCall(args, theme) {
      const p = args as { session_id: string; code: string };
      const preview = p.code.length > 80
        ? p.code.slice(0, 80).replace(/\n/g, " ") + "…"
        : p.code.replace(/\n/g, " ");
      const text = theme.fg("toolTitle", theme.bold("pexpect ")) +
        theme.fg("accent", "exec") +
        " " +
        theme.fg("dim", `[${p.session_id}]`) +
        " " +
        theme.fg("muted", preview);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const text = result.content
        ?.filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("\n") ?? "";

      if (result.isError) {
        return new Text(theme.fg("error", text), 0, 0);
      }

      const lines = text.split("\n");

      if (!expanded) {
        const COLLAPSED_LINES = 8;
        const preview = lines.slice(0, COLLAPSED_LINES).join("\n");
        const remaining = lines.length - COLLAPSED_LINES;
        let collapsed = preview;
        if (remaining > 0) {
          collapsed += "\n" +
            theme.fg("dim", `… ${remaining} more lines (Ctrl+O to expand)`);
        }
        return new Text(collapsed, 0, 0);
      }

      const container = new Container();
      const mdTheme = getMarkdownTheme(theme);
      container.addChild(
        new Markdown("```\n" + text + "\n```", 0, 0, mdTheme),
      );
      return container;
    },
  });

  // Tool 3: pexpect_stop
  pi.registerTool({
    name: "pexpect_stop",
    description:
      "Stop a pexpect session and clean up resources. The session's pueue task will be terminated. Always stop sessions when done to avoid resource leaks.",
    parameters: Type.Object({
      session_id: Type.String({
        description: "The 8-character hex session ID to stop",
      }),
    }),
    async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
      try {
        ensurePueueRunning();

        // Verify session exists
        const listOutput = runPexpectCli(["--list"]);
        const sessions = parseSessionList(listOutput);
        const session = sessions.find((s) => s.id === params.session_id);

        if (!session) {
          return {
            content: [
              {
                type: "text",
                text: `Session \`${params.session_id}\` not found or already stopped.`,
              },
            ],
          };
        }

        runPexpectCli(["--stop", params.session_id]);

        const message = session.name
          ? `Stopped session \`${params.session_id}\` (${session.name})`
          : `Stopped session \`${params.session_id}\``;

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text", text: `Failed to stop session: ${msg}` },
          ],
          isError: true,
        };
      }
    },

    renderCall(args, theme) {
      const p = args as { session_id: string };
      const text = theme.fg("toolTitle", theme.bold("pexpect ")) +
        theme.fg("accent", "stop") +
        " " +
        theme.fg("dim", `[${p.session_id}]`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const text = result.content
        ?.filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("\n") ?? "";
      return new Text(
        result.isError ? theme.fg("error", text) : theme.fg("success", text),
        0,
        0,
      );
    },
  });

  // Tool 4: pexpect_list
  pi.registerTool({
    name: "pexpect_list",
    description:
      "List all active pexpect sessions managed by pueue. Shows session IDs (8-char hex), status, and optional names. Session IDs are different from pueue task IDs.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _onUpdate, _ctx, _signal) {
      try {
        ensurePueueRunning();

        const listOutput = runPexpectCli(["--list"]);
        const sessions = parseSessionList(listOutput);

        if (sessions.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No active pexpect sessions. Use pexpect_start to create one.",
              },
            ],
          };
        }

        let output = "Active pexpect sessions:\n\n";
        for (const session of sessions) {
          if (session.name) {
            output += `- \`${session.id}\`: ${session.status} (${session.name})\n`;
          } else {
            output += `- \`${session.id}\`: ${session.status}\n`;
          }
        }

        return {
          content: [{ type: "text", text: output.trim() }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text", text: `Failed to list sessions: ${msg}` },
          ],
          isError: true,
        };
      }
    },

    renderCall(_args, theme) {
      const text = theme.fg("toolTitle", theme.bold("pexpect ")) +
        theme.fg("accent", "list");
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const text = result.content
        ?.filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("\n") ?? "";

      if (result.isError) {
        return new Text(theme.fg("error", text), 0, 0);
      }

      const container = new Container();
      const mdTheme = getMarkdownTheme(theme);
      container.addChild(new Markdown(text, 0, 0, mdTheme));
      return container;
    },
  });
}

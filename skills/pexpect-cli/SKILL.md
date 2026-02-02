---
name: pexpect-cli
description: Automate interactive CLI programs with persistent sessions using pexpect-cli and pueue. Use when needing to automate programs that require interactive input/output (SSH sessions, database CLIs, vim/editors, interactive shells, or any program with prompts). Provides session management, real-time monitoring, and persistent state across multiple commands.
---

# pexpect-cli

Use the `pexpect_start`, `pexpect_exec`, `pexpect_stop`, and `pexpect_list` tools for all pexpect operations. The `pexpect_exec` tool description contains the full API reference — this skill teaches the *workflow* for effective interactive automation.

## Workflow

### 1. Start a named session

Always name sessions for clarity:

```
pexpect_start({ name: "ssh-prod" })
```

Save the returned session ID — you need it for every subsequent call.

### 2. Spawn the target process first

The first `pexpect_exec` call should spawn the process and wait for the initial prompt:

```
pexpect_exec({
  session_id: "abc12345",
  code: "child = pexpect.spawn('ssh user@host')\nchild.expect('password:', timeout=30)\nchild.sendline('mypassword')\nchild.expect('[#$]', timeout=30)\nprint('Connected')"
})
```

The `child` variable persists across calls — subsequent `pexpect_exec` calls can use it directly.

### 3. Execute commands incrementally

Send one logical operation per `pexpect_exec` call. This makes debugging easier:

```
pexpect_exec({
  session_id: "abc12345",
  code: "child.sendline('uptime')\nchild.expect('[#$]', timeout=10)\nprint(child.before.decode())"
})
```

Don't try to do everything in a single code block.

### 4. Always handle errors

Wrap expect() calls in try/except. The two failure modes are:
- `pexpect.TIMEOUT` — the expected pattern never appeared
- `pexpect.EOF` — the process exited unexpectedly

If you get a timeout, the session is still alive. Check what's on screen with `print(child.before.decode())` and adjust the expect pattern.

### 5. Clean up

Always stop sessions when done:

```
pexpect_stop({ session_id: "abc12345" })
```

Use `pexpect_list()` to check for leaked sessions.

## Key Principles

- **Always set timeouts on expect()**: `child.expect('prompt', timeout=30)`. Without a timeout, a missing prompt hangs the entire execution forever.
- **Use generic prompt patterns**: `'[#$]'` or `'\\$'` instead of `'user@host:~$'`. Prompts vary between systems.
- **Use expect() with a list for branching**: `index = child.expect(['password:', 'yes/no', pexpect.TIMEOUT])` returns the index of the matched pattern. Use this for multi-path flows (password prompts, SSH key confirmation, errors).
- **Output requires print()**: Only text passed to `print()` is captured and returned. `child.before.decode()` gives you what appeared between the last two matches.
- **One session per interactive process**: Don't try to multiplex. Start separate sessions for separate processes.
- **After exit, expect EOF**: When a process is done (`sendline('exit')`), wait for `pexpect.EOF`, not a shell prompt.

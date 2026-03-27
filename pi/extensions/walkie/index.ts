/**
 * Walkie Extension
 *
 * Bridges pi coding agent sessions to Telegram for mobile use.
 *
 * Bidirectional:
 *   pi → Telegram  — push agent responses after each run (with live draft streaming on by default)
 *   Telegram → pi  — inject messages as user prompts (idle or followUp delivery)
 *
 * Draft streaming uses sendMessageDraft (Bot API 9.3+, all bots since 9.5):
 *   - 512-byte delta threshold, 4s flush interval, 12s heartbeat
 *   - Progress preview with tail excerpt when buffer exceeds 3000 bytes
 *   - Stale draft ID protection
 *   - suppressUntil backoff on 429 responses
 *
 * Setup:
 *   /walkie setup   — enter pairing mode (next Telegram message claims the chat)
 *   /walkie         — toggle on/off
 *   /walkie status  — show current config
 *   /walkie stream  — toggle live draft streaming
 *
 * Telegram bot commands (sent from your phone):
 *   /abort   — send abort steer to pi
 *   /status  — show agent status
 *   /new     — queue new session when agent is done
 */

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as tg from "./telegram.js";
import { createProvider, detectProvider, type STTProvider } from "../voice/providers.js";
import {
  DRAFT_HEARTBEAT_INTERVAL_MS,
  type AgentStats,
  type DraftFlush,
  type DraftState,
  appendDraftChunk,
  buildFinalMessage,
  chunkText,
  createDraftState,
  escapeHTML,
  formatForTelegram,
  heartbeatDraft,
  suppressDraftUntil,
} from "./format.js";

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".pi", "walkie.json");

interface WalkieConfig {
  botToken: string;
  chatId: number;
  allowedUserId: number;
  enabled: boolean;
  /** Use sendMessageDraft for live streaming preview (default: true — available to all bots since Bot API 9.5) */
  streaming: boolean;
  /** Unix timestamp (ms) until which sendMessageDraft is suppressed — set when peer returns TEXTDRAFT_PEER_INVALID */
  draftSuppressedUntil?: number;
}

function loadConfigSync(): Partial<WalkieConfig> {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<WalkieConfig>;
  } catch {
    return {};
  }
}

async function persistConfig(config: Partial<WalkieConfig>): Promise<void> {
  try {
    await mkdir(join(homedir(), ".pi"), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch {
    // non-critical
  }
}

// ── Voice / STT helpers ───────────────────────────────────────────────────────

const VOICE_CONFIG_PATH = join(homedir(), ".pi", "voice.json");

interface VoiceConfig {
  provider?: string;
  lang?: string;
}

function loadVoiceConfigSync(): VoiceConfig {
  try {
    return JSON.parse(readFileSync(VOICE_CONFIG_PATH, "utf8")) as VoiceConfig;
  } catch {
    return {};
  }
}

/**
 * Return the best available STT provider for transcribing Telegram voice
 * messages. Reads ~/.pi/voice.json for the configured provider and language.
 * Daemon is now fully supported via its POST /transcribe endpoint.
 */
function getSttProvider(): STTProvider | null {
  const vc = loadVoiceConfigSync();
  if (vc.provider) return createProvider(vc.provider as "groq" | "openai" | "daemon");
  return detectProvider()?.provider ?? null;
}

function isConfigured(c: Partial<WalkieConfig>): c is WalkieConfig {
  return (
    typeof c.botToken === "string" &&
    c.botToken.length > 0 &&
    typeof c.chatId === "number" &&
    typeof c.allowedUserId === "number"
  );
}

// ── Interactive choices ───────────────────────────────────────────────────────

interface ChoiceOption {
  id: string;
  label: string;
  submit_text: string;
}

interface PendingInteraction {
  options: ChoiceOption[];
  messageId: number | null;
  expiresAt: number;
}

const INTERACTION_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * System prompt appended when walkie is active so the agent knows how to
 * produce Telegram inline keyboard choices.
 */
const CHOICES_SYSTEM_PROMPT = `
## Telegram Interactive Buttons

When communicating via Telegram you may present the user with tappable choice buttons by appending a JSON block at the very end of your response (after all your text):

{"v":1,"options":[
  {"id":"a","label":"✅ Option A","submit_text":"I choose option A"},
  {"id":"b","label":"❌ Option B","submit_text":"I choose option B"}
]}

Rules:
- 2–4 options only
- label: shown on the Telegram button (keep it short, ≤ 30 chars)
- submit_text: injected as the user's next message when the button is tapped
- Use only for genuine discrete choices, not open-ended questions
- The JSON block must be the very last thing in your response`.trim();

/**
 * Extract a choices block from the end of an assistant response.
 * Returns the visible text (without the JSON) and the parsed options, or
 * null choices if no valid block is found.
 */
function parseChoicesBlock(text: string): { visibleText: string; choices: ChoiceOption[] | null } {
  const marker = '{"v":1,"options":[';
  const idx = text.lastIndexOf(marker);
  if (idx === -1) return { visibleText: text, choices: null };
  try {
    const block = JSON.parse(text.slice(idx)) as { v: number; options: ChoiceOption[] };
    if (!Array.isArray(block.options)) return { visibleText: text, choices: null };
    if (block.options.length < 2 || block.options.length > 4) return { visibleText: text, choices: null };
    if (!block.options.every(o => o.id && o.label && o.submit_text)) return { visibleText: text, choices: null };
    return { visibleText: text.slice(0, idx).trim(), choices: block.options };
  } catch {
    return { visibleText: text, choices: null };
  }
}

function buildChoicesKeyboard(interactionId: number, options: ChoiceOption[]): tg.InlineKeyboardMarkup {
  return {
    inline_keyboard: options.map(opt => [{
      text: opt.label,
      callback_data: `wk:${interactionId}:${opt.id}`,
    }]),
  };
}

// ── Bot command menu ──────────────────────────────────────────────────────────

/** Default (English) command descriptions — registered as the global fallback */
const BOT_COMMANDS: tg.BotCommand[] = [
  { command: "abort",   description: "Stop the current agent run immediately" },
  { command: "status",  description: "Show agent state, model, and context usage" },
  { command: "compact", description: "Compress context to free up space" },
  { command: "new",     description: "New session (queued if agent is active)" },
  { command: "think",   description: "Cycle thinking level: none → low → high" },
  { command: "stream",  description: "Toggle live draft preview on/off" },
  { command: "on",      description: "Enable walkie notifications" },
  { command: "off",     description: "Disable walkie notifications" },
];

/** Spanish translations — shown when the user's Telegram language is set to Spanish */
const BOT_COMMANDS_ES: tg.BotCommand[] = [
  { command: "abort",   description: "Detener la ejecución del agente inmediatamente" },
  { command: "status",  description: "Ver estado del agente, modelo y contexto" },
  { command: "compact", description: "Comprimir el contexto para liberar espacio" },
  { command: "new",     description: "Nueva sesión (en cola si el agente está activo)" },
  { command: "think",   description: "Cambiar nivel de razonamiento: ninguno → bajo → alto" },
  { command: "stream",  description: "Activar/desactivar vista previa en tiempo real" },
  { command: "on",      description: "Activar notificaciones de walkie" },
  { command: "off",     description: "Desactivar notificaciones de walkie" },
];

// ── Extension ─────────────────────────────────────────────────────────────────

export default function walkieExtension(pi: ExtensionAPI) {
  // ─── Module-level state ──────────────────────────────────────────────────

  let config: Partial<WalkieConfig> = loadConfigSync();
  let pollingAbort: AbortController | null = null;
  /** True while pi agent loop is running (between agent_start → agent_end) */
  let isStreaming = false;
  /** True after /walkie setup — next Telegram message claims chat_id + user_id */
  let setupMode = false;
  /** Stored ctx for abort() calls from polling loop */
  let lastCtx: ExtensionContext | null = null;

  // ─── Per-run counters (reset on agent_start) ─────────────────────────────

  let agentStartTime: number | null = null;
  let turnCount = 0;
  let filesChanged = 0;
  /** message_id of the inbound Telegram message that triggered the current run */
  let runTriggerMessageId: number | null = null;
  /** Current activity label shown in heartbeat messages (thinking / tool / generic) */
  let agentPhase = "Processing request...";

  // ─── Pending inline keyboard interactions ────────────────────────────────

  const pendingInteractions = new Map<number, PendingInteraction>();
  let interactionSeq = 0;

  function cleanExpiredInteractions(): void {
    const now = Date.now();
    for (const [id, interaction] of pendingInteractions) {
      if (interaction.expiresAt <= now) pendingInteractions.delete(id);
    }
  }

  // ─── Draft state (only active when config.streaming = true) ─────────────

  let draftState: DraftState | null = null;
  let draftIdCounter = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Keep-alive typing indicator for tool-call phases with no text output */
  let typingTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const { theme, setStatus } = ctx.ui;

    if (!config.enabled) {
      setStatus("walkie", theme.fg("warning", "walkie:off"));
      return;
    }
    if (setupMode) {
      setStatus("walkie", theme.fg("warning", "walkie:setup"));
      return;
    }
    if (!isConfigured(config)) {
      setStatus("walkie", theme.fg("error", "walkie:unconfigured"));
      return;
    }
    setStatus("walkie", theme.fg("success", "walkie:on"));
  }

  /** Send text to Telegram as HTML (converted from markdown), falling back to plain */
  async function send(text: string, extraOptions?: Partial<tg.SendMessageOptions>): Promise<void> {
    if (!isConfigured(config) || !config.enabled) return;
    const { botToken, chatId } = config;

    const formatted = formatForTelegram(text);
    const chunks = chunkText(formatted);

    for (const chunk of chunks) {
      try {
        await tg.sendMessage(botToken, chatId, chunk, { parse_mode: "HTML", ...extraOptions });
      } catch (err) {
        // HTML parse failure (400) → abandon formatted send, retry ALL as plain
        if (err instanceof tg.TelegramError && err.statusCode === 400) {
          const plainChunks = chunkText(text);
          for (const plain of plainChunks) {
            await tg.sendMessage(botToken, chatId, plain, extraOptions).catch(() => {});
          }
          return;
        }
        // Other errors (network, rate limit) → silently ignore
      }
    }
  }

  /** Send plain text with no parse mode */
  async function sendPlain(text: string): Promise<void> {
    if (!isConfigured(config) || !config.enabled) return;
    const { botToken, chatId } = config;
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      await tg.sendMessage(botToken, chatId, chunk).catch(() => {});
    }
  }

  /** Flush a DraftFlush to sendMessageDraft, handling 429 backoff */
  async function flushDraft(flush: DraftFlush): Promise<void> {
    if (!isConfigured(config) || !config.enabled || !config.streaming) return;
    if (!draftState || flush.draftId !== draftState.draftId) return; // stale

    try {
      await tg.sendMessageDraft(config.botToken, config.chatId, flush.draftId, flush.text);
    } catch (err) {
      if (err instanceof tg.TelegramError) {
        if (err.statusCode === 429) {
          const backoffMs = (err.retryAfter ?? 5) * 1000;
          if (draftState) suppressDraftUntil(draftState, backoffMs);
        } else if (err.description.includes("TEXTDRAFT_PEER_INVALID")) {
          // This peer does not support drafts (e.g. group chat, channel).
          // Persist suppression for 24h so future sessions don't retry.
          config.draftSuppressedUntil = Date.now() + 24 * 60 * 60 * 1000;
          await persistConfig(config).catch(() => {});
          draftState = null;
        }
      }
    }
  }

  function stopTimers(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  }

  function stopPolling(): void {
    pollingAbort?.abort();
    pollingAbort = null;
  }

  // ─── Polling Loop ─────────────────────────────────────────────────────────

  async function startPolling(initialOffset = 0): Promise<void> {
    if (pollingAbort) return; // already running
    if (!isConfigured(config) && !setupMode) return;
    if (!config.botToken) return;

    pollingAbort = new AbortController();
    const { signal } = pollingAbort;
    const token = config.botToken;

    let offset = initialOffset;
    let errorCount = 0;

    while (!signal.aborted) {
      try {
        const updates = await tg.getUpdates(token, { offset, timeout: 30 }, signal);
        errorCount = 0;

        for (const update of updates) {
          offset = update.update_id + 1;
          handleUpdate(update).catch(() => {});
        }
      } catch (err) {
        if (signal.aborted) break;
        errorCount++;
        // Exponential backoff: 1s, 2s, 4s … 60s max
        const backoffMs = Math.min(1_000 * 2 ** (errorCount - 1), 60_000);
        await sleep(backoffMs, signal).catch(() => {});
      }
    }
  }

  async function handleUpdate(update: tg.TelegramUpdate): Promise<void> {
    // ── Setup mode: claim the first real user ────────────────────────────
    if (setupMode && update.message?.from && !update.message.from.is_bot) {
      config.chatId = update.message.chat.id;
      config.allowedUserId = update.message.from.id;
      config.enabled = true;
      setupMode = false;
      await persistConfig(config);

      if (lastCtx) updateStatus(lastCtx);

      // Register bot commands so Telegram shows the /command menu
      await tg.setMyCommands(config.botToken!, BOT_COMMANDS).catch(() => {});
      await tg.setMyCommands(config.botToken!, BOT_COMMANDS_ES, "es").catch(() => {});

      await tg
        .sendMessage(
          config.botToken!,
          config.chatId,
          "✅ Paired! Pi will send updates to this chat.",
        )
        .catch(() => {});
      return;
    }

    // ── Security: only accept from allowedUserId ─────────────────────────
    if (!isConfigured(config)) return;

    const senderId =
      update.message?.from?.id ?? update.callback_query?.from.id;
    if (senderId !== config.allowedUserId) return;

    // ── Inline button press ───────────────────────────────────────────────
    if (update.callback_query) {
      const cq = update.callback_query;
      // Dismiss the loading spinner immediately
      await tg.answerCallbackQuery(config.botToken, cq.id).catch(() => {});

      if (cq.data?.startsWith("wk:")) {
        // walkie choice button — resolve the submit_text and inject it
        const parts = cq.data.split(":");
        const interactionId = Number(parts[1]);
        const optionId = parts[2];
        const interaction = pendingInteractions.get(interactionId);

        if (interaction && interaction.expiresAt > Date.now()) {
          const opt = interaction.options.find(o => o.id === optionId);
          if (opt) {
            pendingInteractions.delete(interactionId);
            // Clear the inline keyboard so it can't be tapped again
            if (interaction.messageId !== null) {
              await tg.editMessageReplyMarkup(config.botToken, config.chatId, interaction.messageId).catch(() => {});
            }
            // Inject the submit_text as a user message
            if (isStreaming) {
              pi.sendUserMessage(opt.submit_text, { deliverAs: "followUp" });
            } else {
              pi.sendUserMessage(opt.submit_text);
            }
          }
        }
      } else if (cq.data) {
        // Emit for other extensions to handle (future approval flow)
        pi.events.emit("walkie:callback", { data: cq.data });
      }
      return;
    }

    // ── Text message ──────────────────────────────────────────────────────
    if (!update.message) return;
    const msg = update.message;
    const text = msg.text?.trim() ?? "";

    // Bot commands
    if (text.startsWith("/abort")) {
      await tg
        .sendMessage(config.botToken, config.chatId, "⛔ Abort signal sent.")
        .catch(() => {});

      if (isStreaming) {
        // Steer with a stop request — agent sees it after its current turn
        pi.sendUserMessage("Stop what you're doing and summarize what happened.", {
          deliverAs: "steer",
        });
      }
      // Also call ctx.abort() if we have a context
      lastCtx?.abort();
      return;
    }

    if (text.startsWith("/status")) {
      const projectName = lastCtx ? basename(lastCtx.cwd) : "unknown";
      const modelName = lastCtx?.model?.name ?? "unknown";
      const usage = lastCtx?.getContextUsage();
      const usageStr = usage?.percent != null
        ? `${Math.round(usage.percent)}% · ${(usage.tokens ?? 0).toLocaleString()} tokens`
        : "unknown";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const thinkingLevel = (pi as any).getThinkingLevel?.() ?? "unknown";
      const html = [
        `📍 <b>Pi Status</b>`,
        `Project: <code>${escapeHTML(projectName)}</code>`,
        `Agent: ${isStreaming ? "🔄 running" : "⏸ idle"}`,
        `Model: <code>${escapeHTML(String(modelName))}</code>`,
        `Context: ${usageStr}`,
        `Thinking: ${thinkingLevel}`,
        `Streaming: ${config.streaming ? "✅" : "❌"}`,
        `Walkie: ${config.enabled ? "✅" : "❌"}`,
      ].join("\n");
      await tg.sendMessage(config.botToken, config.chatId, html, { parse_mode: "HTML" }).catch(() => {});
      return;
    }

    if (text.startsWith("/think")) {
      const levels = ["none", "low", "high"] as const;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = String((pi as any).getThinkingLevel?.() ?? "none");
      const idx = levels.indexOf(current as typeof levels[number]);
      const next = levels[(idx + 1) % levels.length]!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pi as any).setThinkingLevel?.(next);
      await sendPlain(`🧠 Thinking: ${current} → ${next}`).catch(() => {});
      return;
    }

    if (text.startsWith("/compact")) {
      if (isStreaming) {
        await sendPlain("⚠️ Cannot compact while agent is running.").catch(() => {});
        return;
      }
      await sendPlain("🗜 Compacting context...").catch(() => {});
      lastCtx?.compact({
        onComplete: async () => {
          await sendPlain("✅ Context compacted.").catch(() => {});
        },
        onError: async (err) => {
          await sendPlain(`❌ Compaction failed: ${err.message}`).catch(() => {});
        },
      });
      return;
    }

    if (text.startsWith("/new")) {
      if (isStreaming) {
        pi.sendUserMessage(
          "When you're done, please start a new session.",
          { deliverAs: "followUp" },
        );
        await sendPlain("📋 Queued: new session after current task.").catch(() => {});
      } else {
        await sendPlain("⚠️ Use /new in the terminal to start a new session.").catch(() => {});
      }
      return;
    }

    if (text.startsWith("/stream")) {
      config.streaming = !config.streaming;
      await persistConfig(config);
      if (lastCtx) updateStatus(lastCtx);
      await sendPlain(`📡 Streaming ${config.streaming ? "enabled ✅" : "disabled ❌"}`).catch(() => {});
      return;
    }

    if (text.startsWith("/off")) {
      // Send confirmation before disabling — sendPlain no-ops when enabled=false
      await sendPlain("🔕 Notifications disabled. Send /on to re-enable.").catch(() => {});
      config.enabled = false;
      await persistConfig(config);
      if (lastCtx) updateStatus(lastCtx);
      return;
    }

    if (text.startsWith("/on")) {
      config.enabled = true;
      await persistConfig(config);
      if (lastCtx) updateStatus(lastCtx);
      await sendPlain("🔔 Notifications enabled.").catch(() => {});
      return;
    }

    // ── Regular text message → inject into pi ────────────────────────────
    if (text) {
      // React 👀 immediately to acknowledge receipt
      await tg.setMessageReaction(config.botToken, config.chatId, msg.message_id, "👀").catch(() => {});

      if (isStreaming) {
        pi.sendUserMessage(text, { deliverAs: "followUp" });
      } else {
        // This message triggers a new run — record its ID for ✅ on completion
        runTriggerMessageId = msg.message_id;
        pi.sendUserMessage(text);
      }
    }

    // ── Photo → download + inject as image content ────────────────────────
    if (msg.photo && msg.photo.length > 0) {
      await tg.setMessageReaction(config.botToken, config.chatId, msg.message_id, "👀").catch(() => {});

      const largest = msg.photo[msg.photo.length - 1]!;
      try {
        const fileInfo = await tg.getFile(config.botToken, largest.file_id);
        if (fileInfo.file_path) {
          const buf = await tg.downloadFile(config.botToken, fileInfo.file_path);
          const caption = (msg.caption ?? msg.text ?? "Image from Telegram").trim();

          const content = [
            { type: "text" as const, text: caption },
            {
              type: "image" as const,
              data: buf.toString("base64"),
              mimeType: "image/jpeg",
            },
          ];

          if (isStreaming) {
            pi.sendUserMessage(content, { deliverAs: "followUp" });
          } else {
            runTriggerMessageId = msg.message_id;
            pi.sendUserMessage(content);
          }
        }
      } catch {
        // Image injection is best-effort
      }
    }

    // ── Voice message → transcribe via STT + inject as text ──────────────
    if (msg.voice) {
      await tg.setMessageReaction(config.botToken, config.chatId, msg.message_id, "👀").catch(() => {});

      const stt = getSttProvider();
      if (!stt) {
        await sendPlain(
          "⚠️ No STT provider for voice transcription.\nSet GROQ_API_KEY or OPENAI_API_KEY and run /voice config.",
        ).catch(() => {});
        return;
      }

      try {
        const fileInfo = await tg.getFile(config.botToken, msg.voice.file_id);
        if (!fileInfo.file_path) return;

        const buf = await tg.downloadFile(config.botToken, fileInfo.file_path);
        const lang = loadVoiceConfigSync().lang ?? "en";
        const transcription = await stt.transcribe(buf, lang, "", {
          mimeType: "audio/ogg",
          filename: "voice.ogg",
        });

        if (!transcription.trim()) {
          await sendPlain("⚠️ No speech detected.").catch(() => {});
          return;
        }

        // Echo transcription back so the user can see what was understood
        await sendPlain(`🎤 ${transcription.trim()}`).catch(() => {});
        await tg.setMessageReaction(config.botToken, config.chatId, msg.message_id, "✅").catch(() => {});

        if (isStreaming) {
          pi.sendUserMessage(transcription.trim(), { deliverAs: "followUp" });
        } else {
          runTriggerMessageId = msg.message_id;
          pi.sendUserMessage(transcription.trim());
        }
      } catch (err) {
        await sendPlain(
          `❌ Transcription failed: ${err instanceof Error ? err.message : String(err)}`,
        ).catch(() => {});
      }
    }
  }

  // ─── Pi Events ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    config = { enabled: true, streaming: true, ...loadConfigSync() };

    updateStatus(ctx);

    if (!config.botToken) return;
    // Skip updates that accumulated while pi was offline, then start polling.
    // Outbound sends are gated on config.enabled — polling always runs when configured.
    const initialOffset = isConfigured(config)
      ? await tg.getNextUpdateOffset(config.botToken).catch(() => 0)
      : 0;
    startPolling(initialOffset).catch(() => {});

    // Ensure bot command menu is registered (idempotent, best-effort)
    if (isConfigured(config)) {
      await tg.setMyCommands(config.botToken, BOT_COMMANDS).catch(() => {});
      await tg.setMyCommands(config.botToken, BOT_COMMANDS_ES, "es").catch(() => {});
    }

    // Only notify on a genuinely fresh session (no prior entries)
    const isFresh = ctx.sessionManager.getEntries().length === 0;
    if (isFresh && isConfigured(config)) {
      const projectName = basename(ctx.cwd);
      await sendPlain(`🟢 Pi started · ${projectName}`).catch(() => {});
    }
  });

  pi.on("session_switch", async (_event, ctx) => {
    lastCtx = ctx;
    if (!isConfigured(config) || !config.enabled) return;
    const projectName = basename(ctx.cwd);
    await sendPlain(`📂 Session switched · ${projectName}`).catch(() => {});
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!isConfigured(config) || !config.enabled) return;
    return { systemPrompt: CHOICES_SYSTEM_PROMPT };
  });

  pi.on("agent_start", async (_event, ctx) => {
    lastCtx = ctx;
    isStreaming = true;
    agentStartTime = Date.now();
    turnCount = 0;
    filesChanged = 0;
    agentPhase = "Processing request...";
    // runTriggerMessageId is intentionally NOT reset here — it is set by
    // handleUpdate before agent_start fires, so we must preserve it.

    if (!isConfigured(config) || !config.enabled) return;

    // Keep-alive typing indicator every 4s until the first draft flush is visible
    typingTimer = setInterval(async () => {
      if (!isConfigured(config) || !config.enabled) return;
      if (draftState?.lastFlushLen) return; // draft is already visible, stop typing indicator
      await tg.sendChatAction(config.botToken!, config.chatId!, "typing").catch(() => {});
    }, 4_000);

    if (!config.streaming) return;

    // Skip draft creation if this peer previously returned TEXTDRAFT_PEER_INVALID
    if (config.draftSuppressedUntil && Date.now() < config.draftSuppressedUntil) return;

    // Create fresh draft state for this run
    draftIdCounter++;
    draftState = createDraftState(draftIdCounter, agentStartTime);

    // Heartbeat timer: fires every DRAFT_HEARTBEAT_INTERVAL_MS
    heartbeatTimer = setInterval(async () => {
      if (!draftState) return;
      const flush = heartbeatDraft(draftState, Date.now(), agentPhase);
      if (flush) await flushDraft(flush).catch(() => {});
    }, DRAFT_HEARTBEAT_INTERVAL_MS);
  });

  // message_update is typed in pi's internal types.d.ts but MessageUpdateEvent
  // is not re-exported from the package root index — cast to any for this handler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pi as any).on("message_update", async (event: any) => {
    const ae = event?.assistantMessageEvent;
    if (!ae) return;

    if (ae.type === "thinking_delta") {
      // Track phase for heartbeat label — don't add raw thoughts to the draft buffer
      agentPhase = "🧠 Thinking...";
      return;
    }

    if (ae.type !== "text_delta" || typeof ae.delta !== "string") return;

    // Switched from thinking to text output — reset phase label
    agentPhase = "Processing request...";

    if (!config.streaming || !draftState || !isConfigured(config) || !config.enabled) return;
    const flush = appendDraftChunk(draftState, ae.delta as string, Date.now());
    if (flush) await flushDraft(flush).catch(() => {});
  });

  pi.on("turn_start", async (event) => {
    turnCount = event.turnIndex + 1;
  });

  pi.on("tool_call", async (event) => {
    const toolName = (event as any).toolName as string;
    agentPhase = `🔧 ${toolName}...`;
  });

  pi.on("tool_result", async (event) => {
    const toolName = (event as any).toolName as string;
    if ((toolName === "edit" || toolName === "write") && !event.isError) {
      filesChanged++;
    }
    agentPhase = "Processing request...";
  });

  pi.on("agent_end", async (event, ctx) => {
    lastCtx = ctx;
    isStreaming = false;
    stopTimers();
    draftState = null;

    if (!isConfigured(config) || !config.enabled) return;

    const elapsed = agentStartTime !== null ? Date.now() - agentStartTime : 0;
    agentStartTime = null;

    // Extract last assistant text (skip thinking blocks + tool calls)
    let lastAssistantText = "";
    for (const msg of [...event.messages].reverse()) {
      const m = msg as any;
      if (m.role !== "assistant") continue;

      const text = ((m.content ?? []) as any[])
        .filter((c: any) => c.type === "text")
        .map((c: any) => (c.text ?? "") as string)
        .join("\n")
        .trim();

      if (text) {
        lastAssistantText = text;
        break;
      }
    }

    if (!lastAssistantText) return;

    const stats: AgentStats = {
      turnCount,
      filesChanged,
      elapsedMs: elapsed,
    };

    cleanExpiredInteractions();

    const { visibleText, choices } = parseChoicesBlock(lastAssistantText);
    const body = buildFinalMessage(choices ? visibleText : lastAssistantText, stats);
    const replyOptions = runTriggerMessageId !== null
      ? { reply_parameters: { message_id: runTriggerMessageId } }
      : undefined;

    if (choices) {
      // Send with inline keyboard
      interactionSeq++;
      const id = interactionSeq;
      const keyboard = buildChoicesKeyboard(id, choices);
      const formatted = formatForTelegram(body);

      let sentMessageId: number | null = null;
      try {
        const msg = await tg.sendMessage(config.botToken, config.chatId, formatted, {
          parse_mode: "HTML",
          reply_markup: keyboard,
          ...replyOptions,
        });
        sentMessageId = msg.message_id;
      } catch {
        // HTML failed → retry plain
        try {
          const msg = await tg.sendMessage(config.botToken, config.chatId, body, {
            reply_markup: keyboard,
            ...replyOptions,
          });
          sentMessageId = msg.message_id;
        } catch { /* best-effort */ }
      }

      pendingInteractions.set(id, {
        options: choices,
        messageId: sentMessageId,
        expiresAt: Date.now() + INTERACTION_TTL_MS,
      });
    } else {
      await send(body, replyOptions).catch(() => {});
    }

    // React ✅ on the message that triggered this run
    if (isConfigured(config) && runTriggerMessageId !== null) {
      await tg.setMessageReaction(config.botToken, config.chatId, runTriggerMessageId, "✅").catch(() => {});
    }
    runTriggerMessageId = null;
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    stopPolling();
    stopTimers();
    if (isConfigured(config) && config.enabled) {
      await sendPlain("🔴 Pi session ended").catch(() => {});
    }
  });

  // ─── Commands ─────────────────────────────────────────────────────────────

  pi.registerCommand("walkie", {
    description: "Telegram bridge — toggle, setup, or configure",

    getArgumentCompletions: (prefix: string) => {
      const subs = ["setup", "start", "stop", "status", "stream"];
      const filtered = subs.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ value: s, label: s })) : null;
    },

    handler: async (args, ctx) => {
      lastCtx = ctx;
      const sub = args.trim().toLowerCase();

      // ── No arg: toggle ─────────────────────────────────────────────────
      if (!sub) {
        config.enabled = !config.enabled;
        await persistConfig(config);
        updateStatus(ctx);
        ctx.ui.notify(config.enabled ? "Walkie enabled" : "Walkie disabled", "info");

        if (config.enabled && isConfigured(config) && !pollingAbort) {
          startPolling().catch(() => {});
        } else if (!config.enabled) {
          stopPolling();
        }
        return;
      }

      switch (sub) {
        // ── Setup: enter pairing mode ─────────────────────────────────────
        case "setup": {
          {
            const hint = config.botToken
              ? `Current: ${config.botToken.slice(0, 12)}… — leave blank to keep, or enter a new token`
              : "Enter your Telegram bot token from @BotFather";
            const token = await ctx.ui.input("Bot Token", hint);
            if (token === null) {
              ctx.ui.notify("Setup cancelled", "info");
              return;
            }
            const trimmed = token.trim();
            if (trimmed) {
              config.botToken = trimmed;
              await persistConfig(config);
            } else if (!config.botToken) {
              ctx.ui.notify("No bot token provided — setup cancelled.", "warning");
              return;
            }
          }

          setupMode = true;
          config.enabled = true;
          await persistConfig(config);
          updateStatus(ctx);

          // Restart polling with the new token
          stopPolling();
          startPolling().catch(() => {});

          ctx.ui.notify(
            "📱 Send any message to your Telegram bot to pair this chat.",
            "info",
          );
          break;
        }

        // ── Start ──────────────────────────────────────────────────────────
        case "start": {
          config.enabled = true;
          await persistConfig(config);
          updateStatus(ctx);

          if (isConfigured(config) && !pollingAbort) {
            startPolling().catch(() => {});
          }
          ctx.ui.notify("Walkie started", "info");
          break;
        }

        // ── Stop ───────────────────────────────────────────────────────────
        case "stop": {
          config.enabled = false;
          await persistConfig(config);
          stopPolling();
          updateStatus(ctx);
          ctx.ui.notify("Walkie stopped", "info");
          break;
        }

        // ── Stream: toggle live draft preview ─────────────────────────────
        case "stream": {
          config.streaming = !config.streaming;
          await persistConfig(config);
          ctx.ui.notify(
            `Live draft streaming ${config.streaming ? "enabled (default)" : "disabled"}`,
            "info",
          );
          break;
        }

        // ── Status ─────────────────────────────────────────────────────────
        case "status": {
          const lines = [
            `Token   : ${config.botToken ? config.botToken.slice(0, 12) + "…" : "not set"}`,
            `Chat ID : ${config.chatId ?? "not set"}`,
            `User ID : ${config.allowedUserId ?? "not set"}`,
            `Enabled : ${config.enabled ? "yes" : "no"}`,
            `Stream  : ${config.streaming ? "yes" : "no"}`,
            `Polling : ${pollingAbort ? "active" : "stopped"}`,
            `Agent   : ${isStreaming ? "running" : "idle"}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          break;
        }

        default:
          ctx.ui.notify(
            "Usage: /walkie [setup | start | stop | status | stream]",
            "warning",
          );
      }
    },
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}



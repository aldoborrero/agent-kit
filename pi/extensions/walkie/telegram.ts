/**
 * Minimal Telegram Bot API client.
 * Uses Node.js built-in fetch — zero dependencies.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  /** Set for messages in a forum topic */
  message_thread_id?: number;
  /** True when the message belongs to a forum topic thread */
  is_topic_message?: boolean;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  chat_instance: string;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
  disable_notification?: boolean;
  disable_web_page_preview?: boolean;
  /** Reply to a specific message in the chat (creates a thread-like view) */
  reply_parameters?: { message_id: number };
  /** Send to a specific forum topic thread */
  message_thread_id?: number;
}

// ── Error ────────────────────────────────────────────────────────────────────

export class TelegramError extends Error {
  readonly statusCode: number;
  readonly retryAfter?: number;
  readonly description: string;

  constructor(method: string, description: string, statusCode: number, retryAfter?: number) {
    super(`Telegram ${method}: ${description} (${statusCode})`);
    this.name = "TelegramError";
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
    this.description = description;
  }
}

// ── Core HTTP ────────────────────────────────────────────────────────────────

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const url = `https://api.telegram.org/bot${token}/${method}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  const json = (await res.json()) as TelegramResponse<T>;

  if (!json.ok) {
    const retryAfter = json.parameters?.retry_after;
    throw new TelegramError(
      method,
      json.description ?? "Unknown error",
      json.error_code ?? res.status,
      retryAfter,
    );
  }

  return json.result;
}

// ── API Methods ───────────────────────────────────────────────────────────────

export async function getUpdates(
  token: string,
  params: { offset?: number; timeout?: number },
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>(
    token,
    "getUpdates",
    {
      offset: params.offset,
      timeout: params.timeout ?? 30,
      allowed_updates: ["message", "callback_query"],
    },
    signal,
  );
}

/**
 * Fetch the latest pending update_id + 1 without processing any updates.
 * Pass the result as the initial offset to startPolling() to skip messages
 * accumulated while the bot was offline.
 * Returns 0 if there are no pending updates or on error.
 */
export async function getNextUpdateOffset(token: string): Promise<number> {
  try {
    const updates = await call<TelegramUpdate[]>(token, "getUpdates", {
      offset: -1,
      timeout: 0,
      allowed_updates: ["message", "callback_query"],
    });
    if (updates.length === 0) return 0;
    return updates[updates.length - 1]!.update_id + 1;
  } catch {
    return 0;
  }
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options?: SendMessageOptions,
): Promise<TelegramMessage> {
  return call<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...options,
  });
}

export async function sendMessageDraft(
  token: string,
  chatId: number,
  draftId: number,
  text: string,
  options?: { parseMode?: "MarkdownV2" | "HTML"; messageThreadId?: number },
): Promise<true> {
  return call<true>(token, "sendMessageDraft", {
    chat_id: chatId,
    draft_id: draftId,
    text,
    ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options?.messageThreadId ? { message_thread_id: options.messageThreadId } : {}),
  });
}

export async function sendChatAction(
  token: string,
  chatId: number,
  action: "typing" | "upload_document",
  messageThreadId?: number,
): Promise<true> {
  return call<true>(token, "sendChatAction", {
    chat_id: chatId,
    action,
    ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
  });
}

export async function createForumTopic(
  token: string,
  chatId: number,
  name: string,
): Promise<{ message_thread_id: number }> {
  return call<{ message_thread_id: number }>(token, "createForumTopic", {
    chat_id: chatId,
    name,
  });
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<true> {
  return call<true>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

export async function editMessageReplyMarkup(
  token: string,
  chatId: number,
  messageId: number,
): Promise<true> {
  return call<true>(token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function getFile(
  token: string,
  fileId: string,
): Promise<TelegramFile> {
  return call<TelegramFile>(token, "getFile", { file_id: fileId });
}

export interface BotCommand {
  command: string;
  description: string;
}

export async function setMessageReaction(
  token: string,
  chatId: number,
  messageId: number,
  emoji: string,
): Promise<true> {
  return call<true>(token, "setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }],
    is_big: false,
  });
}

export async function setMyCommands(
  token: string,
  commands: BotCommand[],
  languageCode?: string,
): Promise<true> {
  return call<true>(token, "setMyCommands", {
    commands,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

export async function downloadFile(
  token: string,
  filePath: string,
): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

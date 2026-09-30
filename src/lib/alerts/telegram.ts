/**
 * Telegram channel: Bot API sendMessage to TELEGRAM_CHAT_ID using TELEGRAM_BOT_TOKEN.
 * The token is part of the request path, so the URL is never logged, stored or put in an error.
 * https://core.telegram.org/bots/api#sendmessage
 */
import { formatAlertText, optionalEnv, type AlertChannel, type AlertMessage } from './channels';

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 15_000;

export class TelegramError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

export interface TelegramCredentials {
  token: string;
  chatId: string;
}

export function telegramCredentials(): TelegramCredentials | null {
  const token = optionalEnv('TELEGRAM_BOT_TOKEN');
  const chatId = optionalEnv('TELEGRAM_CHAT_ID');
  return token && chatId ? { token: token.trim(), chatId: chatId.trim() } : null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Sends one plain-text message. Throws TelegramError (without the URL/token) on failure. */
export async function sendTelegramMessage(
  text: string,
  creds: TelegramCredentials,
  opts: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<void> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await doFetch(`${API}/bot${encodeURIComponent(creds.token)}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text: text.slice(0, 4096), disable_web_page_preview: true }),
      signal,
      redirect: 'error',
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    throw new TelegramError(name === 'TimeoutError' || name === 'AbortError' ? 'telegram: request timed out' : 'telegram: network error', null);
  }
  let description = '';
  let ok = res.ok;
  try {
    const body = (await res.json()) as { ok?: unknown; description?: unknown };
    if (body.ok === false) ok = false;
    if (typeof body.description === 'string') description = body.description.slice(0, 200);
  } catch {
    // Non-JSON body: fall back to the HTTP status.
  }
  if (!ok) throw new TelegramError(`telegram: HTTP ${res.status}${description ? ` ${description}` : ''}`, res.status);
}

export const telegramChannel: AlertChannel = {
  name: 'telegram',
  isConfigured: () => telegramCredentials() !== null,
  async send(msg: AlertMessage, signal?: AbortSignal) {
    const creds = telegramCredentials();
    if (!creds) throw new TelegramError('telegram: not configured', null);
    await sendTelegramMessage(formatAlertText(msg), creds, { signal });
  },
};

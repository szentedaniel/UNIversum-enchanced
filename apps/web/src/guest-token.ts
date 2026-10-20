/**
 * This browser's Guest token (spec: Guest identity): 128 random bits, made
 * once and kept in `localStorage`, sent only in create and join options so the
 * Room can give this browser its Seat back from any tab or after a restart.
 * Without storage (a private window that refuses it) it lasts for this page.
 */
import { GUEST_TOKEN_PATTERN } from "@universum/protocol/messages";

const KEY = "universum.guestToken";

let token: string | null = null;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function guestToken(): string {
  if (token) return token;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && GUEST_TOKEN_PATTERN.test(stored)) return (token = stored);
  } catch {
    // No storage: a token for this page only.
  }
  token = newToken();
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // As above.
  }
  return token;
}

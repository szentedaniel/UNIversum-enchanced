/**
 * Guest tokens (spec: Guest identity). The browser sends its token only in
 * create and join options; the Room keeps only its hash, against the Seat,
 * and never sends or logs either.
 */
import { createHash } from "node:crypto";
import { GUEST_TOKEN_PATTERN } from "@universum/protocol";

/** The Guest token in a client's create or join options, or `null` if it has none (or a malformed one). */
export function guestTokenIn(options: unknown): string | null {
  if (typeof options !== "object" || options === null || !("guestToken" in options)) return null;
  const token = options.guestToken;
  return typeof token === "string" && GUEST_TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * The hash the Room keeps. A Guest token has 128 random bits, so a plain
 * SHA-256 is enough: nobody can guess a token from its hash.
 */
export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

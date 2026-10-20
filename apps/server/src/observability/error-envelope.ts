/**
 * The Sentry envelope pieces the `/errors` tunnel needs (spec: Observability →
 * Errors): split an envelope into its items, drop everything that is not an
 * `event`, strip the IP and any token from an event's payload, and put the
 * envelope back together with the real DSN in its header.
 *
 * Envelope format (https://develop.sentry.dev/sdk/envelopes/): a JSON header
 * line, then per item a JSON header line and its payload, whose byte length is
 * in the item header's `length` (or one line when `length` is absent).
 */
import { z } from "zod";

export type EnvelopeItem = { header: Record<string, unknown>; payload: Buffer };
export type Envelope = { header: Record<string, unknown>; items: EnvelopeItem[] };

/** A JSON object from the wire; anything else (an array, a scalar, bad JSON) is `null`. */
const JSON_OBJECT = z.record(z.string(), z.unknown());

function parseJsonObject(bytes: Buffer): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(bytes.toString("utf8"));
    const parsed = JSON_OBJECT.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The envelope in `body`, or `null` when it is malformed. */
export function splitEnvelope(body: Buffer): Envelope | null {
  const headerEnd = body.indexOf(0x0a);
  if (headerEnd < 0) return null;
  const header = parseJsonObject(body.subarray(0, headerEnd));
  if (header === null) return null;
  const items: EnvelopeItem[] = [];
  let offset = headerEnd + 1;
  while (offset < body.length) {
    const lineEnd = body.indexOf(0x0a, offset);
    if (lineEnd < 0) return null;
    const itemHeader = parseJsonObject(body.subarray(offset, lineEnd));
    if (itemHeader === null) return null;
    offset = lineEnd + 1;
    const length = itemHeader["length"];
    let payload: Buffer;
    if (typeof length === "number" && Number.isInteger(length) && length >= 0) {
      if (offset + length > body.length) return null;
      payload = body.subarray(offset, offset + length);
      offset += length;
      if (body[offset] === 0x0a) offset += 1;
    } else {
      // No length: the payload runs to the next newline, or to the end of the
      // envelope (the browser SDK omits the last item's trailing newline).
      const end = body.indexOf(0x0a, offset);
      const payloadEnd = end < 0 ? body.length : end;
      payload = body.subarray(offset, payloadEnd);
      offset = payloadEnd + (end < 0 ? 0 : 1);
    }
    items.push({ header: itemHeader, payload });
  }
  return { header, items };
}

/** The envelope as bytes, with each item's `length` made to match its payload. */
export function joinEnvelope({ header, items }: Envelope): Buffer {
  const parts: Buffer[] = [Buffer.from(`${JSON.stringify(header)}\n`)];
  for (const { header: itemHeader, payload } of items) {
    parts.push(
      Buffer.from(`${JSON.stringify({ ...itemHeader, length: payload.length })}\n`),
      payload,
      Buffer.from("\n"),
    );
  }
  return Buffer.concat(parts);
}

/** Keys whose value is a secret or personal data, at any depth (whole key names, not substrings). */
const SENSITIVE =
  /^(?:guest_?token(?:_?hash)?|reconnection_?token|token(?:_?hash)?|password(?:_?hash)?|ip(?:_?address)?|remote_?address)$/i;

/** Request fields that only ever carry headers, cookies or the environment, all of them stripped. */
const REQUEST_PRIVATE: Record<string, true> = { headers: true, cookies: true, env: true };

/** What a secret value inside a string becomes. */
const FILTERED = "[Filtered]";

/** `key=value` pairs (query strings, URLs) whose value is a secret; the key stays. */
const SECRET_PAIR = /\b(reconnection_?token|guest_?token|token|password)=[^&#\s"'<>]*/gi;

/** A bare Guest token: 32 hex characters (how the browser makes one), not part of a longer hex run. */
const BARE_GUEST_TOKEN = /\b[0-9a-f]{32}\b/gi;

/**
 * Removes the IP and every token, password and request header from an event
 * payload, in place. Returns `false` when the payload is not a JSON object
 * (then the whole item is dropped).
 */
export function sanitizeEvent(payload: Buffer): Buffer | null {
  const event = parseJsonObject(payload);
  if (event === null) return null;
  return Buffer.from(JSON.stringify(stripValue(event)));
}

/**
 * Mutates `value` in place, so objects inside arrays (breadcrumbs) are cleaned
 * too. Strings are scrubbed as well: a token can sit inside a URL, a query
 * string or an exception message, not only under a key of its own.
 */
function stripValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_PAIR, `$1=${FILTERED}`).replace(BARE_GUEST_TOKEN, FILTERED);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = stripValue(value[i]);
    return value;
  }
  if (typeof value !== "object" || value === null) return value;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE.test(key) || REQUEST_PRIVATE[key] === true) {
      Reflect.deleteProperty(value, key);
      continue;
    }
    Reflect.set(value, key, stripValue(entry));
  }
  return value;
}

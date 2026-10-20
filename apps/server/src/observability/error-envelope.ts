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
      const end = body.indexOf(0x0a, offset);
      if (end < 0) return null;
      payload = body.subarray(offset, end);
      offset = end + 1;
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

/**
 * Removes the IP and every token, password and request header from an event
 * payload, in place. Returns `false` when the payload is not a JSON object
 * (then the whole item is dropped).
 */
export function sanitizeEvent(payload: Buffer): Buffer | null {
  const event = parseJsonObject(payload);
  if (event === null) return null;
  strip(event);
  return Buffer.from(JSON.stringify(event));
}

function strip(record: Record<string, unknown>): void {
  for (const [key, entry] of Object.entries(record)) {
    if (SENSITIVE.test(key) || REQUEST_PRIVATE[key] === true) {
      delete record[key];
      continue;
    }
    stripValue(entry);
  }
}

/** Mutates `value` in place, so objects inside arrays (breadcrumbs) are cleaned too. */
function stripValue(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) stripValue(entry);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE.test(key) || REQUEST_PRIVATE[key] === true) {
      Reflect.deleteProperty(value, key);
      continue;
    }
    stripValue(entry);
  }
}

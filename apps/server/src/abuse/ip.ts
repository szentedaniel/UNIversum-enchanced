/**
 * What per-IP limits are keyed on (spec: Abuse protection): the client's IP,
 * an IPv6 address bucketed by its /64 (one host usually gets a whole /64).
 */
import type { IncomingHttpHeaders } from "node:http";
import { isIPv4, isIPv6 } from "node:net";

/**
 * The client's address, resolved as Colyseus does (`X-Real-IP`, then the first
 * hop of `X-Forwarded-For`, then `X-Client-IP`, then the socket). Caddy
 * overwrites `X-Real-IP` and drops `X-Client-IP`, so behind it this is the
 * real client; the Node port is never published.
 */
export function clientIp(
  headers: IncomingHttpHeaders,
  remoteAddress: string | undefined,
): string | undefined {
  const firstHop = (name: string): string | undefined => {
    const value = headers[name];
    const raw = Array.isArray(value) ? value[0] : value;
    return raw?.split(",")[0]?.trim() || undefined;
  };
  return (
    firstHop("x-real-ip") ?? firstHop("x-forwarded-for") ?? firstHop("x-client-ip") ?? remoteAddress
  );
}

/** The limiter key of an address: IPv4 as is, IPv6 as its /64, anything else `unknown`. */
export function ipBucket(ip: string | undefined): string {
  if (ip === undefined) return "unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (isIPv4(ip)) return ip;
  const address = ip.split("%")[0] ?? "";
  if (!isIPv6(address)) return "unknown";
  return `${expandIPv6(address).slice(0, 4).join(":")}::/64`;
}

const groups = (part: string): string[] => (part === "" ? [] : part.split(":"));

/** The eight groups of an IPv6 address, lowercase, without leading zeros. */
function expandIPv6(address: string): string[] {
  const [head = "", tail] = address.toLowerCase().split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => "0");
  return [...left, ...zeros, ...right].map((group) => Number.parseInt(group, 16).toString(16));
}

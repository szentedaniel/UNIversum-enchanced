import { createHmac, randomBytes } from "node:crypto";
import type { Logger } from "#observability/logger.ts";
import type { GameMetrics, LimiterLimit } from "#observability/metrics.ts";

const SALT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Turns an IP bucket (the limiter's key: an IPv4 address or an IPv6 /64) into its log tag. */
export type IpTagger = (ipBucket: string) => string;

/**
 * The only form in which an IP reaches a log line (spec: Observability →
 * Logs): 8 hex of an HMAC of the limiter bucket. The salt lives in memory
 * only and is replaced every 24 h, so a tag links one abuser's refusals
 * within a day and can't be turned back into the IP or matched across days.
 */
export function createIpTagger(now: () => number = Date.now): IpTagger {
  let salt = randomBytes(32);
  let saltCreatedAt = now();
  return (ipBucket) => {
    if (now() - saltCreatedAt >= SALT_LIFETIME_MS) {
      salt = randomBytes(32);
      saltCreatedAt = now();
    }
    return createHmac("sha256", salt).update(ipBucket).digest("hex").slice(0, 8);
  };
}

/** What a limiter needs to report a refusal. */
export type RefusalReporting = { log: Logger; metrics: GameMetrics; ipTag: IpTagger };

/**
 * An abuse limit refused a request (#37's limiters call this): counted in
 * `limiter_refusals_total{limit}` and logged with the IP tag, never the IP.
 */
export function limiterRefused(
  { log, metrics, ipTag }: RefusalReporting,
  limit: LimiterLimit,
  ipBucket: string,
): void {
  metrics.limiterRefused(limit);
  log.info({ limit, ipTag: ipTag(ipBucket) }, "limit refused");
}

/**
 * A failed run's log is mostly setup noise and can be tens of megabytes; the
 * prompt only needs the end, where the failure is.
 */

/** How much of a failed job log the prompt gets, unless a caller says less. */
export const EXCERPT_CHARS = 12_000;

const TRIMMED = "… (earlier output trimmed)\n";

/** The tail of a log, cut to `maxChars` and marked where it was cut. */
export const excerptOf = (log: string, maxChars = EXCERPT_CHARS): string => {
  const trimmed = log.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  const tail = trimmed.slice(-Math.max(0, maxChars - TRIMMED.length));
  // Start at a line boundary so the excerpt does not open mid-message.
  const firstNewline = tail.indexOf("\n");
  const whole = firstNewline === -1 ? tail : tail.slice(firstNewline + 1);
  return `${TRIMMED}${whole}`;
};

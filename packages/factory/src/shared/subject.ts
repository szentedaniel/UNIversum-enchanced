/**
 * The commits check's subject limit, mirrored because the factory's own
 * commits pass `pnpm run check:commits` in CI
 * (`packages/repo-checks/src/commits.ts`).
 */
const SUBJECT_LIMIT = 100;

/**
 * `prefix` followed by `title` as one commit subject the check accepts:
 * whitespace collapsed, cut at a word boundary when it would pass the limit,
 * and never ending in punctuation or whitespace (the rules refuse both).
 */
export const subjectOf = (prefix: string, title: string): string => {
  const room = SUBJECT_LIMIT - prefix.length;
  const cleaned = title.replace(/\s+/gu, " ").trim();
  let body = cleaned.slice(0, Math.max(room, 0));
  if (cleaned.length > body.length) {
    const boundary = body.lastIndexOf(" ");
    if (boundary > 0) body = body.slice(0, boundary);
  }
  body = body.replace(/[.:;,!-]+$/u, "").trimEnd();
  return `${prefix}${body}`.trimEnd();
};

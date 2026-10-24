/**
 * What the source fences share (#63's server clock, #72's Decision): blank the
 * comments, walk a source tree, and name a violation the same way, so each
 * fence keeps only its rule.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** `source` with its comments blanked; block comments keep their newlines. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
    .replace(/\/\/.*$/gm, "");
}

/** Every `.ts`/`.tsx` file under `dir`, minus the generated Paraglide messages. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.includes("/paraglide/"));
}

/** One violation, as `file:line: rule — use replacement. Line: code`. */
export function violation(
  file: string,
  line: number,
  code: string,
  rule: string,
  instead: string,
): string {
  return `${file}:${line}: ${rule} — use ${instead}. Line: ${code}`;
}

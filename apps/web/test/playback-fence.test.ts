/**
 * ADR-0004 fences (spec #58, ticket #55).
 *
 * Two rules were broken once and had to be reviewed back in #53; nothing
 * stopped a relapse. These tests read every file under `apps/web/src` and fail
 * when a forbidden pattern comes back. They match source text, so the matchers
 * stay narrow: a false alarm breaks the build for an innocent line.
 *
 * Rule 1 — one source of Playback durations. `PLAYBACK_MS` is a rules constant
 * (`packages/rules/src/playback.ts`); the only code that scales it is
 * `playbackOfEvent` (`Moved` times its `steps`), and `playbackOf` sums a list.
 * Web code calls those, never arithmetic on a `PLAYBACK_MS` entry or on a
 * `Moved` step count, and the `playback/` modules hold no `*_MS` duration of
 * their own. UI timings that are not Playback lengths (`board.ts` `PAN_MS` and
 * `FIT_MS`, `gestures.ts` `TAP_MS`, `pick/sale.ts` `AUTO_SELL_WARNING_MS`) are
 * allowed.
 *
 * Rule 2 — one server-clock estimate. Every push carries `clockOffset`; the
 * only place that adds it to a client clock reading is `serverNow` in
 * `lib/server-clock.ts`. Every other module — the ring, the Minute pill, the
 * Board, the Lobby — calls `serverNow`. `decisionOpensAt` in
 * `playback/playback-store.ts` keeps its inverse (`actsAfter - clockOffset`),
 * which turns a server timestamp into a client one and is not the same
 * operation; it is the one named exception.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_SRC = fileURLToPath(new URL("../src", import.meta.url));

/** The keywords after which a `/` opens a regex literal, not a division. */
const REGEX_KEYWORDS: Record<string, true> = {
  await: true,
  case: true,
  delete: true,
  do: true,
  else: true,
  in: true,
  instanceof: true,
  new: true,
  of: true,
  return: true,
  typeof: true,
  void: true,
  yield: true,
};

/** The characters after which a `/` opens a regex literal, not a division. */
const REGEX_PUNCTUATION = "([{=,:;!&|?+-*%^~<>";

/**
 * `source` with its comments blanked, newlines kept so line numbers survive.
 * Strings, template literals and regex literals are copied whole: a `//` in
 * `"https://…"`, `` `…//…` `` or `/\/\//` must not swallow the rest of the
 * line, or a real violation after it would go unseen.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let last = ""; // the last non-space character kept: tells `/` (division) from a regex
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out.push("\n");
        i += 1;
      }
      i += 2;
      last = " "; // a comment separates tokens, like a space
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      out.push(char);
      i += 1;
      while (i < source.length) {
        const inner = source[i]!;
        out.push(inner);
        i += 1;
        if (inner === "\\") {
          if (i < source.length) out.push(source[i++]!);
          continue;
        }
        if (inner === char) break;
        if (inner === "\n" && char !== "`") break; // unterminated: give up, keep scanning
      }
      last = char;
      continue;
    }
    if (char === "/" && opensRegex(out, last)) {
      out.push(char);
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const inner = source[i]!;
        out.push(inner);
        i += 1;
        if (inner === "\\") {
          if (i < source.length) out.push(source[i++]!);
          continue;
        }
        if (inner === "\n") break; // unterminated: give up, keep scanning
        if (inner === "[") inClass = true;
        else if (inner === "]") inClass = false;
        else if (inner === "/" && !inClass) break;
      }
      last = "/";
      continue;
    }
    out.push(char);
    if (!/\s/.test(char)) last = char;
    i += 1;
  }
  return out.join("");
}

/** Whether a `/` after `last` opens a regex literal (the usual heuristic). */
function opensRegex(out: readonly string[], last: string): boolean {
  if (last === "") return true;
  if (REGEX_PUNCTUATION.includes(last)) return true;
  const word = out
    .slice(-16)
    .join("")
    .trimEnd()
    .match(/(\w+)$/)?.[1];
  return word !== undefined && REGEX_KEYWORDS[word] === true;
}

/** Every `.ts`/`.tsx` file under `dir`, minus the generated Paraglide output. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "paraglide") continue; // generated by Paraglide
      files.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files.toSorted();
}

type Violation = {
  /** Path from `apps/web/src`, e.g. `playback/timeline.ts`. */
  file: string;
  /** 1-based line. */
  line: number;
  rule: string;
  instead: string;
  text: string;
};

type Fence = {
  pattern: RegExp;
  rule: string;
  instead: string;
  /** Which files the fence covers; all of `src` by default. */
  only?: (file: string) => boolean;
  /** The named exceptions: a line the fence lets through. */
  except?: (file: string, line: string) => boolean;
};

/** Every line of `apps/web/src` that trips `fence`. */
function violations(fence: Fence): Violation[] {
  const found: Violation[] = [];
  for (const path of sourceFiles(WEB_SRC)) {
    const file = relative(WEB_SRC, path);
    if (fence.only && !fence.only(file)) continue;
    const lines = stripComments(readFileSync(path, "utf8")).split("\n");
    for (const [index, text] of lines.entries()) {
      if (!fence.pattern.test(text)) continue;
      if (fence.except?.(file, text)) continue;
      found.push({
        file,
        line: index + 1,
        rule: fence.rule,
        instead: fence.instead,
        text: text.trim(),
      });
    }
  }
  return found;
}

/** `file:line: rule — use instead. Offending line: …` */
function report(found: readonly Violation[]): string[] {
  return found.map((v) => `${v.file}:${v.line}: ${v.rule} — use ${v.instead}. Line: ${v.text}`);
}

const DURATIONS = "@universum/rules/playback (ADR-0004)";

/** Arithmetic on a `PLAYBACK_MS` entry, either side of the operator. */
const PLAYBACK_MS_ARITHMETIC = {
  pattern: /PLAYBACK_MS(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])?\s*[+\-*/]|[*/]\s*PLAYBACK_MS/,
  rule: `Playback durations come only from ${DURATIONS}`,
  instead: "playbackOfEvent(event) or playbackOf(events), never arithmetic on a PLAYBACK_MS entry",
} as const;

/**
 * Scaling a `Moved` step count into a length: `event.steps * 160`,
 * `steps * PLAYBACK_MS.Moved`, and the reverse order when the other side is a
 * number or a `*_MS` constant. `progress * event.steps` (the pawn's place
 * along the walk, `board/board.ts`) is interpolation, not a duration, and is
 * not a violation.
 */
const STEP_SCALING = {
  pattern: /\.steps\s*\*|(?:\b\d[\d_]*(?:\.\d+)?|\b\w*_MS)\s*\*\s*[\w$?.]+\.steps/,
  rule: `Playback durations come only from ${DURATIONS}`,
  instead: "playbackOfEvent(event) or playbackOf(events), never arithmetic on a Moved step count",
} as const;

/** A numeric `*_MS` constant declared in `apps/web/src/playback/`. */
const PLAYBACK_CONSTANT = {
  pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*_MS\b\s*(?::[^=]+)?=\s*[\d.]/,
  rule: `the playback modules hold no duration of their own (ADR-0004)`,
  instead: "an entry in PLAYBACK_MS (packages/rules/src/playback.ts), read through playbackOfEvent",
  only: (file: string) => file.startsWith("playback/"),
} as const;

/** `clockOffset` added to or subtracted from a clock reading, on either side. */
const CLOCK_ARITHMETIC = {
  pattern: /[+\-*/]\s*[\w$?.]*\bclockOffset\b|\bclockOffset\b\s*[+\-*/]/,
  rule: "the server clock is estimated only in lib/server-clock.ts (ADR-0004)",
  instead: "serverNow(clockOffset) from #lib/server-clock.ts, never Date.now() + clockOffset",
  only: (file: string) => file !== "lib/server-clock.ts",
  // The inverse conversion in decisionOpensAt: a server timestamp to a client one.
  except: (file: string, line: string) =>
    file === "playback/playback-store.ts" && /\bactsAfter\s*-\s*[\w$?.]*clockOffset\b/.test(line),
} as const;

describe("stripComments", () => {
  it("blanks line and block comments and keeps the line numbers", () => {
    const source = [
      "const a = 1; // PLAYBACK_MS.Moved * 2",
      "/*",
      "PLAYBACK_MS.Moved * 2",
      "*/",
      "const b = 2;",
    ].join("\n");
    const stripped = stripComments(source);
    expect(stripped).not.toContain("PLAYBACK_MS");
    expect(stripped.split("\n")).toHaveLength(5);
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain("const b = 2;");
  });

  it("keeps a `//` inside a string, a template literal or a regex literal", () => {
    const source = [
      `const url = "https://example.test"; const a = 1;`,
      "const tpl = `// not a comment`; const b = 2;",
      String.raw`const re = /\/\//; const c = 3;`,
      String.raw`return /\/\//; const d = 4;`,
    ].join("\n");
    const stripped = stripComments(source);
    for (const code of ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"]) {
      expect(stripped).toContain(code);
    }
  });

  it("keeps a division that follows a value", () => {
    expect(stripComments("const half = total / 2; const a = 1;")).toContain("const a = 1;");
  });
});

describe("ADR-0004 playback fence", () => {
  it("scans every web source except the generated Paraglide messages", () => {
    const files = sourceFiles(WEB_SRC).map((path) => relative(WEB_SRC, path));
    expect(files).toContain("playback/timeline.ts");
    expect(files).toContain("lib/server-clock.ts");
    expect(files.some((file) => file.startsWith("paraglide/"))).toBe(false);
    expect(files.length).toBeGreaterThan(50);
  });

  it("takes Playback durations only from @universum/rules/playback", () => {
    expect(report(violations(PLAYBACK_MS_ARITHMETIC))).toEqual([]);
  });

  it("never scales a Moved step count into a duration", () => {
    expect(report(violations(STEP_SCALING))).toEqual([]);
  });

  it("declares no Playback duration constant in playback/", () => {
    expect(report(violations(PLAYBACK_CONSTANT))).toEqual([]);
  });

  it("estimates the server clock only in lib/server-clock.ts", () => {
    expect(report(violations(CLOCK_ARITHMETIC))).toEqual([]);
  });
});

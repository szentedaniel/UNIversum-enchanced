import { describe, expect, it } from "vitest";
import {
  deadPaths,
  handoffIssueBody,
  HANDOFF_MARKER,
  type HandoffNote,
} from "#maintain/handoff.ts";

/** The repo root as the script sees it: these top-level entries exist. */
const ROOTS = ["apps", "docs", "packages", "scripts", "package.json"];

/** A checkout where only the listed paths are in git's tree. */
const facts = (alive: readonly string[], ignored: readonly string[] = []) => ({
  alive: (path: string) =>
    [...ROOTS, ...alive].some((known) => known === path || known.startsWith(`${path}/`)),
  ignored: (path: string) =>
    ignored.some((known) => known === path || path.startsWith(`${known}/`)),
});

const note = (name: string, body: string): HandoffNote => ({ name, body });

describe("deadPaths", () => {
  it("lists the repo paths a note names that git no longer has", () => {
    const notes = [
      note(
        "ticket-1.md",
        "`docs/agents/handoff/INDEX.md`, `apps/web/src/gone.ts` and `apps/web/src/still.ts`.",
      ),
    ];

    expect(
      deadPaths(notes, facts(["docs/agents/handoff/INDEX.md", "apps/web/src/still.ts"])),
    ).toEqual([{ note: "ticket-1.md", path: "apps/web/src/gone.ts" }]);
  });

  it("cuts a directory's trailing slash before checking it", () => {
    const notes = [
      note("ticket-2.md", "Read `docs/agents/handoff/` and `packages/factory/src/gone/`."),
    ];

    expect(deadPaths(notes, facts(["docs/agents/handoff/INDEX.md"]))).toEqual([
      { note: "ticket-2.md", path: "packages/factory/src/gone" },
    ]);
  });

  it("leaves relative names, globs, placeholders, commands and URLs alone", () => {
    const body = [
      "`src/view.ts`",
      "`board/board.ts`",
      "`apps/web/src/**/*.ts`",
      "`apps/web/messages/{hu,en,de}.json`",
      "`agent/issue-<n>-<slug>`",
      "`node packages/factory/src/<step>/<step>.ts`",
      "`https://example.test/apps/web/x`",
      "`node_modules/@inlang/plugin-message-format`",
      "`v1/server/.env`",
    ].join(" ");

    expect(deadPaths([note("ticket-3.md", body)], facts([]))).toEqual([]);
  });

  it("skips build and runtime output: it is not the repo's to keep", () => {
    const notes = [note("ticket-4.md", "`apps/web/src/paraglide`, `apps/server/data`")];

    expect(deadPaths(notes, facts([], ["apps/web/src/paraglide", "apps/server/data"]))).toEqual([]);
  });

  it("names each path once per note, in the order the note writes it", () => {
    const notes = [note("ticket-5.md", "`apps/b.ts`, `apps/a.ts`, `apps/b.ts`")];

    expect(deadPaths(notes, facts([]))).toEqual([
      { note: "ticket-5.md", path: "apps/b.ts" },
      { note: "ticket-5.md", path: "apps/a.ts" },
    ]);
  });
});

describe("handoffIssueBody", () => {
  it("opens with the marker the dedupe reads and lists note then path", () => {
    const body = handoffIssueBody([
      { note: "ticket-51.md", path: "apps/web/test/timeline.test.ts" },
      { note: "ticket-64.md", path: "apps/web/src/lib/server-clock.ts" },
    ]);

    expect(body.startsWith(`${HANDOFF_MARKER}\n`)).toBe(true);
    expect(body).toContain(
      "- `docs/agents/handoff/ticket-51.md`: `apps/web/test/timeline.test.ts`",
    );
    expect(body).toContain(
      "- `docs/agents/handoff/ticket-64.md`: `apps/web/src/lib/server-clock.ts`",
    );
  });
});

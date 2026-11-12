import { describe, expect, it } from "vitest";
import { branchNamesTarget, shareModule, targetPathsIn } from "#shared/targets.ts";

describe("targetPathsIn", () => {
  it("ignores the implementer protocol line every ticket ends with", () => {
    const body =
      "Touch `shared/runs.ts`.\n\nFollow `docs/agents/implementer.md`; the nightly retro opened this ticket.";
    expect(targetPathsIn(body)).toEqual(["shared/runs.ts"]);
    expect(
      shareModule(
        targetPathsIn(body),
        targetPathsIn("Fix a.ts.\nFollow docs/agents/implementer.md."),
      ),
    ).toBe(false);
  });

  it("reads the file paths a ticket body names, full or package-relative", () => {
    const body = [
      "Deepen `shared/runs.ts`, and move fix/decide.ts with it.",
      "## Files",
      "",
      "- `packages/factory/src/maintain/run-red-main.ts` (`runOf`)",
      "- packages/factory/src/maintain/run-flaky-tests.ts",
    ].join("\n");

    expect(targetPathsIn(body)).toEqual([
      "shared/runs.ts",
      "fix/decide.ts",
      "packages/factory/src/maintain/run-red-main.ts",
      "packages/factory/src/maintain/run-flaky-tests.ts",
    ]);
  });

  it("reads a deep module directory too, but not prose or a package root", () => {
    const body = [
      "Keep it in `apps/server/src/room`; read/write is `src/foo.ts`.",
      "`.github/` and `packages/factory/` are protected paths.",
    ].join("\n");

    expect(targetPathsIn(body)).toEqual(["apps/server/src/room", "src/foo.ts"]);
  });

  it("ignores URLs, versions, commit hashes and command flags", () => {
    const body = [
      "See https://github.com/example/repo/blob/main/packages/factory/src/shared/runs.ts",
      "Version 1.3.1 landed in b1edf6e with `--log-failed` and 128 MB.",
    ].join("\n");

    expect(targetPathsIn(body)).toEqual([]);
  });

  it("drops the shared files every ticket touches", () => {
    expect(
      targetPathsIn(
        "Append a line to `docs/agents/handoff/INDEX.md`, then link `shared/runs.ts` and pnpm-lock.yaml.",
      ),
    ).toEqual(["shared/runs.ts"]);
  });

  it("lists a repeated path once, in the order it appears", () => {
    const body = "`a/one.ts` then `b/two.ts`, and a/one.ts again.";

    expect(targetPathsIn(body)).toEqual(["a/one.ts", "b/two.ts"]);
  });
});

describe("shareModule", () => {
  it("matches a package-relative path to its full path", () => {
    expect(shareModule(["shared/runs.ts"], ["packages/factory/src/shared/runs.ts"])).toBe(true);
    expect(
      shareModule(["shared/runs.ts", "unrelated.md"], ["packages/factory/src/shared/runs.ts"]),
    ).toBe(true);
  });

  it("matches the same full path and the same directory's file", () => {
    expect(
      shareModule(
        ["packages/factory/src/dispatch/frontier.ts"],
        ["packages/factory/src/dispatch/frontier.ts"],
      ),
    ).toBe(true);
    expect(shareModule(["apps/server/src/room"], ["apps/server/src/room/turn-clock.ts"])).toBe(
      true,
    );
  });

  it("keeps same-named files under different packages apart", () => {
    expect(shareModule(["apps/web/src/foo.ts"], ["apps/server/src/foo.ts"])).toBe(false);
  });

  it("does not treat a package root or a broad folder as a module", () => {
    expect(shareModule(["packages/factory"], ["packages/factory/src/dispatch/frontier.ts"])).toBe(
      false,
    );
    expect(shareModule([".github"], [".github/workflows/ci.yml"])).toBe(false);
  });

  it("matches a bare file name, but not a generic one", () => {
    expect(shareModule(["turn-clock.ts"], ["apps/server/src/room/turn-clock.ts"])).toBe(true);
    expect(shareModule(["index.ts"], ["apps/web/src/foo/index.ts"])).toBe(false);
  });

  it("never matches the shared ledger, factory log or lockfile", () => {
    expect(shareModule(["docs/agents/handoff/INDEX.md"], ["docs/agents/handoff/INDEX.md"])).toBe(
      false,
    );
    expect(shareModule(["docs/agents/factory-log.md"], ["docs/agents/factory-log.md"])).toBe(false);
    expect(shareModule(["pnpm-lock.yaml"], ["pnpm-lock.yaml"])).toBe(false);
  });
});

describe("branchNamesTarget", () => {
  it("matches the module's specific segments in a factory branch slug", () => {
    expect(
      branchNamesTarget(
        "agent/issue-140-room-turn-clock-extract-the-clock",
        "apps/server/src/room/turn-clock.ts",
      ),
    ).toBe(true);
  });

  it("does not match a generic directory or file pair on an unrelated pull", () => {
    expect(
      branchNamesTarget(
        "agent/issue-129-deepen-the-run-log-reader-in-shared-runs-ts-so-one",
        "shared/runs.ts",
      ),
    ).toBe(false);
    expect(
      branchNamesTarget("agent/issue-170-rewrite-src-index", "packages/factory/src/index.ts"),
    ).toBe(false);
  });

  it("does not match a different branch", () => {
    expect(branchNamesTarget("agent/issue-160-gameroom-crash", "shared/runs.ts")).toBe(false);
  });
});

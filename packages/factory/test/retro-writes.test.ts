import { describe, expect, it } from "vitest";
import { applyWrites, type RetroIo } from "#retro/writes.ts";

const ISSUE_URL = "https://github.com/o/r/issues/42\n";
const PULL_URL = "https://github.com/o/r/pulls/77\n";

type Invocation =
  | { readonly kind: "git"; readonly args: readonly string[] }
  | { readonly kind: "gh"; readonly args: readonly string[] }
  | { readonly kind: "writeTemp"; readonly name: string; readonly content: string };

const testIo = (
  options: {
    readonly branches?: readonly string[];
    readonly failWhen?: (call: Invocation) => boolean;
  } = {},
): { readonly io: RetroIo; readonly calls: Invocation[] } => {
  const calls: Invocation[] = [];
  const note = (call: Invocation): void => {
    calls.push(call);
    if (options.failWhen?.(call) === true) throw new Error(`injected ${call.kind} failure`);
  };
  return {
    calls,
    io: {
      git: (args) => {
        note({ kind: "git", args });
        const branch = args.at(-1) ?? "";
        return args[0] === "ls-remote" && (options.branches ?? []).includes(branch)
          ? `abc123\trefs/heads/${branch}`
          : "";
      },
      gh: (args) => {
        note({ kind: "gh", args });
        return args[0] === "issue" ? ISSUE_URL : PULL_URL;
      },
      writeTemp: (name, content) => {
        note({ kind: "writeTemp", name, content });
        return `/tmp/retro/${name}`;
      },
    },
  };
};

const patch = `diff --git a/CODING_STANDARDS.md b/CODING_STANDARDS.md
--- a/CODING_STANDARDS.md
+++ b/CODING_STANDARDS.md
@@ -1,1 +1,2 @@
 # Coding standards
+Money goes through \`formatMoney\`.
`;

const pull = {
  kind: "standards-pr",
  title: "Name the formatter",
  body: "Why.",
  patch,
  branch: "retro/2026-11-09-name-the-formatter",
} as const;

describe("applyWrites", () => {
  it("creates an issue through gh with the ready-for-agent label and reports its number", () => {
    const { io, calls } = testIo();

    const result = applyWrites(
      [{ kind: "issue", title: "Name the formatter", body: "Why." }],
      "o/r",
      io,
    );

    expect(result).toEqual({ opened: ["Opened #42: Name the formatter"], skipped: [] });
    expect(calls).toEqual([
      { kind: "writeTemp", name: "issue.md", content: "Why." },
      {
        kind: "gh",
        args: [
          "issue",
          "create",
          "--repo",
          "o/r",
          "--title",
          "Name the formatter",
          "--body-file",
          "/tmp/retro/issue.md",
          "--label",
          "ready-for-agent",
        ],
      },
    ]);
  });

  it("pushes a patch branch and opens one ready-for-human pull request, then returns to main", () => {
    const { io, calls } = testIo();

    const result = applyWrites([pull], "o/r", io);

    expect(result).toEqual({
      opened: ["Opened pull request #77: Name the formatter (retro/2026-11-09-name-the-formatter)"],
      skipped: [],
    });
    expect(calls).toEqual([
      { kind: "git", args: ["ls-remote", "--heads", "origin", pull.branch] },
      { kind: "writeTemp", name: "retro.patch", content: patch },
      { kind: "git", args: ["apply", "--check", "/tmp/retro/retro.patch"] },
      { kind: "git", args: ["checkout", "-b", pull.branch] },
      { kind: "git", args: ["apply", "/tmp/retro/retro.patch"] },
      { kind: "git", args: ["add", "-A"] },
      { kind: "git", args: ["commit", "-m", "docs(factory): Name the formatter"] },
      { kind: "git", args: ["push", "origin", `HEAD:${pull.branch}`] },
      { kind: "writeTemp", name: "pull.md", content: "Why." },
      {
        kind: "gh",
        args: [
          "pr",
          "create",
          "--repo",
          "o/r",
          "--base",
          "main",
          "--head",
          pull.branch,
          "--title",
          pull.title,
          "--body-file",
          "/tmp/retro/pull.md",
          "--label",
          "ready-for-human",
        ],
      },
      { kind: "git", args: ["checkout", "main"] },
    ]);
  });

  it("skips a pull write when its branch already exists", () => {
    const { io, calls } = testIo({ branches: [pull.branch] });

    const result = applyWrites([pull], "o/r", io);

    expect(result).toEqual({
      opened: [],
      skipped: [`"Name the formatter": branch ${pull.branch} already exists`],
    });
    expect(calls).toEqual([{ kind: "git", args: ["ls-remote", "--heads", "origin", pull.branch] }]);
  });

  it("skips a pull write when the patch no longer applies to main", () => {
    const { io, calls } = testIo({
      failWhen: (call) => call.kind === "git" && call.args[0] === "apply",
    });

    const result = applyWrites([pull], "o/r", io);

    expect(result).toEqual({
      opened: [],
      skipped: ['"Name the formatter": the patch does not apply to main'],
    });
    expect(calls).toEqual([
      { kind: "git", args: ["ls-remote", "--heads", "origin", pull.branch] },
      { kind: "writeTemp", name: "retro.patch", content: patch },
      { kind: "git", args: ["apply", "--check", "/tmp/retro/retro.patch"] },
    ]);
  });

  it("checks out main when the push fails, and lets the failure through", () => {
    const { io, calls } = testIo({
      failWhen: (call) => call.kind === "git" && call.args[0] === "push",
    });

    expect(() => applyWrites([pull], "o/r", io)).toThrow("injected git failure");
    expect(calls.at(-1)).toEqual({ kind: "git", args: ["checkout", "main"] });
    expect(calls.some((call) => call.kind === "gh")).toBe(false);
  });

  it("checks out main when gh cannot open the pull request, and lets the failure through", () => {
    const { io, calls } = testIo({
      failWhen: (call) => call.kind === "gh" && call.args[0] === "pr",
    });

    expect(() => applyWrites([pull], "o/r", io)).toThrow("injected gh failure");
    expect(calls.at(-1)).toEqual({ kind: "git", args: ["checkout", "main"] });
  });

  it("fails when gh prints no issue number", () => {
    const io: RetroIo = {
      git: () => "",
      gh: () => "not a URL",
      writeTemp: () => "/tmp/retro/issue.md",
    };

    expect(() =>
      applyWrites([{ kind: "issue", title: "Name the formatter", body: "Why." }], "o/r", io),
    ).toThrow("gh printed no issue URL: not a URL");
  });

  it("keeps writing the plan after a skipped pull write", () => {
    const { io, calls } = testIo({ branches: [pull.branch] });

    const result = applyWrites(
      [pull, { kind: "issue", title: "Name the formatter", body: "Why." }],
      "o/r",
      io,
    );

    expect(result.opened).toEqual(["Opened #42: Name the formatter"]);
    expect(result.skipped).toEqual([`"Name the formatter": branch ${pull.branch} already exists`]);
    expect(calls.at(-1)).toEqual({
      kind: "gh",
      args: [
        "issue",
        "create",
        "--repo",
        "o/r",
        "--title",
        "Name the formatter",
        "--body-file",
        "/tmp/retro/issue.md",
        "--label",
        "ready-for-agent",
      ],
    });
  });
});

import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, gh, issueComments, jsonLines } from "#shared/github.ts";

/**
 * A fake `gh` first on PATH: it records its argument array, one per line, in
 * `GH_ARGS_FILE`, prints `GH_STDOUT` and exits with `GH_EXIT`.
 */
const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$@" > "$GH_ARGS_FILE"
cat "$GH_STDOUT"
if [ "\${GH_EXIT:-0}" -ne 0 ]; then
  echo "gh: no such issue" >&2
fi
exit "\${GH_EXIT:-0}"
`;

let path: string | undefined;
let argsFile: string;
let stdoutFile: string;

beforeEach(() => {
  const bin = mkdtempSync(join(tmpdir(), "factory-gh-bin-"));
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  const output = mkdtempSync(join(tmpdir(), "factory-gh-out-"));
  argsFile = join(output, "args.txt");
  stdoutFile = join(output, "stdout.txt");
  writeFileSync(stdoutFile, "");
  process.env["GH_ARGS_FILE"] = argsFile;
  process.env["GH_STDOUT"] = stdoutFile;
  process.env["GH_EXIT"] = "0";
  path = process.env["PATH"];
  process.env["PATH"] = `${bin}:${path ?? ""}`;
});

afterEach(() => {
  if (path === undefined) delete process.env["PATH"];
  else process.env["PATH"] = path;
  delete process.env["GH_ARGS_FILE"];
  delete process.env["GH_STDOUT"];
  delete process.env["GH_EXIT"];
});

/** The argument array the fake `gh` received. */
const received = (): string[] => {
  const lines = readFileSync(argsFile, "utf8").split("\n");
  lines.pop();
  return lines;
};

describe("gh", () => {
  it("hands gh an argument array, so a title with shell metacharacters arrives unchanged", () => {
    const title = `chore(merge): it's a "title" $HOME \`id\`; echo pwned`;

    expect(gh(["issue", "create", "--title", title])).toBe("");
    expect(received()).toEqual(["issue", "create", "--title", title]);
  });

  it("throws when gh exits non-zero, carrying gh's stderr", () => {
    process.env["GH_EXIT"] = "1";

    expect(() => gh(["issue", "view", "1"])).toThrow(/gh: no such issue/);
  });
});

describe("api", () => {
  it("reads every page as one flat list, with the path as one argument", () => {
    writeFileSync(stdoutFile, JSON.stringify([[{ number: 1 }], [{ number: 2 }]]));

    expect(api<{ number: number }>("repos/o/r/issues?state=open&per_page=100")).toEqual([
      { number: 1 },
      { number: 2 },
    ]);
    expect(received()).toEqual([
      "api",
      "--paginate",
      "--slurp",
      "repos/o/r/issues?state=open&per_page=100",
    ]);
  });

  it("keeps a single-object endpoint as one entry", () => {
    writeFileSync(stdoutFile, JSON.stringify([{ number: 7 }]));

    expect(api<{ number: number }>("repos/o/r/issues/7")).toEqual([{ number: 7 }]);
  });
});

describe("issueComments", () => {
  it("reads every comment, oldest first, through the paginated jq read", () => {
    writeFileSync(
      stdoutFile,
      `${JSON.stringify({ body: "first", createdAt: "2026-01-01T00:00:00Z" })}\n${JSON.stringify({ body: "second", createdAt: "2026-01-02T00:00:00Z" })}\n`,
    );

    expect(issueComments("o/r", "42")).toEqual([
      { body: "first", createdAt: "2026-01-01T00:00:00Z" },
      { body: "second", createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(received()).toEqual([
      "api",
      "repos/o/r/issues/42/comments?per_page=100",
      "--paginate",
      "--jq",
      ".[] | {body: .body, createdAt: .created_at}",
    ]);
  });
});

describe("jsonLines", () => {
  it("parses one object per line and skips the blank ones", () => {
    expect(jsonLines<{ n: number }>('{"n":1}\n\n{"n":2}\n')).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

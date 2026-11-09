import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gh, parseJson } from "#shared/github.ts";

/** A `gh` on PATH that records its argv and prints `GH_SHIM_STDOUT`. */
const SHIM = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const log = process.env["GH_SHIM_LOG"];
if (log !== undefined) {
  appendFileSync(log, JSON.stringify(process.argv.slice(2)) + "\\n");
}
process.stdout.write(process.env["GH_SHIM_STDOUT"] ?? "");
`;

const originalPath = process.env["PATH"];
let log: string;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "universum-gh-"));
  log = join(dir, "calls.jsonl");
  process.env["GH_SHIM_LOG"] = log;
  writeFileSync(join(dir, "gh"), SHIM);
  chmodSync(join(dir, "gh"), 0o755);
  process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
});

afterEach(() => {
  if (originalPath === undefined) delete process.env["PATH"];
  else process.env["PATH"] = originalPath;
  delete process.env["GH_SHIM_LOG"];
  delete process.env["GH_SHIM_STDOUT"];
});

const calls = (): string[][] =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => parseJson<string[]>(line));

describe("gh", () => {
  it("hands every argument to gh as its own word, never through a shell", () => {
    process.env["GH_SHIM_STDOUT"] = "ok";

    expect(gh(["issue", "view", "$(touch pwned)", `it's a "title"`])).toBe("ok");
    expect(calls()).toEqual([["issue", "view", "$(touch pwned)", `it's a "title"`]]);
  });
});

import { describe, expect, it } from "vitest";
import { runLog } from "#shared/runs.ts";

describe("runLog", () => {
  it("returns the log gh printed", () => {
    const commands: string[] = [];
    const exec = (command: string): string => {
      commands.push(command);
      return "check\tRun tests\t1 test failed";
    };

    expect(runLog("o/r", 42, { failedOnly: false }, exec)).toBe("check\tRun tests\t1 test failed");
    expect(commands).toEqual(['gh run view 42 --repo "o/r" --log']);
  });

  it("asks for only the failed steps when failedOnly is set", () => {
    const commands: string[] = [];
    const exec = (command: string): string => {
      commands.push(command);
      return "";
    };

    runLog("o/r", "42", { failedOnly: true }, exec);

    expect(commands).toEqual(['gh run view 42 --repo "o/r" --log-failed']);
  });

  it("keeps the stdout of a gh that failed after printing part of the log", () => {
    const exec = (): string => {
      throw Object.assign(new Error("Command failed: gh run view 42"), { stdout: "partial log" });
    };

    expect(runLog("o/r", 42, { failedOnly: true }, exec)).toBe("partial log");
  });

  it("returns an empty string when gh failed without printing a log", () => {
    const exec = (): string => {
      throw new Error("Command failed: gh run view 42");
    };
    const execWithNonTextStdout = (): string => {
      throw Object.assign(new Error("Command failed: gh run view 42"), {
        stdout: Buffer.from("partial log"),
      });
    };

    expect(runLog("o/r", 42, { failedOnly: false }, exec)).toBe("");
    expect(runLog("o/r", 42, { failedOnly: false }, execWithNonTextStdout)).toBe("");
  });
});

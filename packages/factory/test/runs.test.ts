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
});

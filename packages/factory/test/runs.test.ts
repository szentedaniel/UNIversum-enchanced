import { describe, expect, it } from "vitest";
import { runLog } from "#shared/runs.ts";

const REPO = "szentedaniel/UNIversum-enchanced";

describe("runLog", () => {
  it("reads the whole log of the run", () => {
    const commands: string[] = [];

    const log = runLog(REPO, 42540682142, { failedOnly: false }, (command) => {
      commands.push(command);
      return "2026-11-01T10:00:00Z the whole log\n";
    });

    expect(commands).toEqual([
      'gh run view 42540682142 --repo "szentedaniel/UNIversum-enchanced" --log',
    ]);
    expect(log).toBe("2026-11-01T10:00:00Z the whole log\n");
  });

  it("asks for the failed steps only", () => {
    const commands: string[] = [];

    runLog(REPO, 42540682142, { failedOnly: true }, (command) => {
      commands.push(command);
      return "";
    });

    expect(commands).toEqual([
      'gh run view 42540682142 --repo "szentedaniel/UNIversum-enchanced" --log-failed',
    ]);
  });

  it("takes the run id as a number or a string", () => {
    const commands: string[] = [];
    const runner = (command: string): string => {
      commands.push(command);
      return "";
    };

    runLog(REPO, 42, { failedOnly: false }, runner);
    runLog(REPO, "43", { failedOnly: false }, runner);

    expect(commands).toEqual([
      'gh run view 42 --repo "szentedaniel/UNIversum-enchanced" --log',
      'gh run view 43 --repo "szentedaniel/UNIversum-enchanced" --log',
    ]);
  });

  it("keeps the stdout captured before the command failed", () => {
    const partial = "step one\nstep two\n";

    const log = runLog(REPO, 42, { failedOnly: true }, () => {
      throw Object.assign(new Error("spawnSync gh ENOBUFS"), { stdout: partial });
    });

    expect(log).toBe(partial);
  });

  it("returns an empty log when GitHub no longer holds it", () => {
    const log = runLog(REPO, 42, { failedOnly: false }, () => {
      throw new Error("gh: run 42 has no log");
    });

    expect(log).toBe("");
  });

  it("returns an empty log when the error captured no text", () => {
    const log = runLog(REPO, 42, { failedOnly: false }, () => {
      throw Object.assign(new Error("gh: run 42 has no log"), { stdout: Buffer.from("partial") });
    });

    expect(log).toBe("");
  });
});

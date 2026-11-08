import { describe, expect, it } from "vitest";
import { reportFrom, reportStatus } from "#implement/report.ts";

describe("reportFrom", () => {
  it("takes the protocol report from the agent's last message, dropping the narration", () => {
    const stdout = [
      "I'll start by reading the implementer protocol.",
      "Running the checks now.",
      "STATUS: DONE",
      "BRANCH: agent/issue-93-factory-tracer-bullet",
      "",
      "## What landed",
      "",
      "- the omp provider",
    ].join("\n");

    expect(reportFrom(stdout)).toBe(
      [
        "STATUS: DONE",
        "BRANCH: agent/issue-93-factory-tracer-bullet",
        "",
        "## What landed",
        "",
        "- the omp provider",
      ].join("\n"),
    );
  });

  it("takes the last report when the agent wrote one earlier and reported again", () => {
    const stdout = [
      "STATUS: BLOCKED",
      "## Question",
      "- an older answer",
      "Fixed it after all.",
      "STATUS: DONE",
      "## What landed",
      "- the fix",
    ].join("\n");

    expect(reportFrom(stdout)).toBe(["STATUS: DONE", "## What landed", "- the fix"].join("\n"));
  });

  it("falls back to the whole output when the agent wrote no report", () => {
    expect(reportFrom("  Implemented it, no report.  ")).toBe("Implemented it, no report.");
  });

  it("drops Sandcastle's completion signal from the end of the report", () => {
    const stdout = [
      "STATUS: DONE",
      "## What landed",
      "- the fix",
      "<promise>COMPLETE</promise>",
      "",
    ].join("\n");

    expect(reportFrom(stdout)).toBe(["STATUS: DONE", "## What landed", "- the fix"].join("\n"));
  });

  it("keeps the report when narration and the completion signal surround it", () => {
    const stdout = [
      "I'll read the protocol first.",
      "STATUS: BLOCKED",
      "## What landed",
      "- half the ticket",
      "",
      "## Question",
      "- which shape?",
      "<promise>COMPLETE</promise>",
    ].join("\n");

    expect(reportFrom(stdout)).toBe(
      [
        "STATUS: BLOCKED",
        "## What landed",
        "- half the ticket",
        "",
        "## Question",
        "- which shape?",
      ].join("\n"),
    );
  });
});

describe("reportStatus", () => {
  it("reads the report's first line", () => {
    expect(reportStatus("STATUS: DONE\nBRANCH: agent/issue-93-x\n")).toBe("DONE");
    expect(reportStatus("STATUS: BLOCKED\n## Question\n- which shape?")).toBe("BLOCKED");
  });

  it("calls anything else done, so a malformed report still gets reviewed", () => {
    expect(reportStatus("Implemented it, no report.")).toBe("DONE");
    expect(reportStatus("STATUS: BLOCKED\nlater\nSTATUS: BLOCKED")).toBe("BLOCKED");
    expect(reportStatus("## Question\nSTATUS: BLOCKED")).toBe("DONE");
  });
});

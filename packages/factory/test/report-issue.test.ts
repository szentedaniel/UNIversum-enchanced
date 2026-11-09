import { describe, expect, it } from "vitest";
import {
  REPORT_LABEL,
  reportMarker,
  reportPlan,
  reportTitle,
  type ReportIssue,
} from "#report/issue.ts";

const issue = (number: number, title: string, body: string | null = ""): ReportIssue => ({
  number,
  title,
  body,
});

describe("reportMarker", () => {
  it("scopes the hidden marker to the week, so a re-run edits instead of duplicating", () => {
    expect(reportMarker("2026-11-02")).toBe("<!-- factory-report:2026-11-02 -->");
  });
});

describe("reportTitle", () => {
  it("names the Monday the reported week started", () => {
    expect(reportTitle("2026-11-02")).toBe("Factory report: week of 2026-11-02");
    expect(REPORT_LABEL).toBe("factory:report");
  });
});

describe("reportPlan", () => {
  it("opens the first report when there is no report issue yet", () => {
    expect(reportPlan([], "2026-11-02")).toEqual({ action: "create", closes: [] });
  });

  it("opens this week's and closes last week's", () => {
    const last = issue(
      12,
      "Factory report: week of 2026-10-26",
      "<!-- factory-report:2026-10-26 -->",
    );

    expect(reportPlan([last], "2026-11-02")).toEqual({ action: "create", closes: [12] });
  });

  it("edits this week's issue and still closes last week's", () => {
    const last = issue(
      12,
      "Factory report: week of 2026-10-26",
      "<!-- factory-report:2026-10-26 -->",
    );
    const current = issue(
      13,
      "Factory report: week of 2026-11-02",
      "<!-- factory-report:2026-11-02 -->",
    );

    expect(reportPlan([last, current], "2026-11-02")).toEqual({
      action: "edit",
      number: 13,
      closes: [12],
    });
  });

  it("leaves the dispatcher's month issue open: it carries the budget notice", () => {
    const month = issue(9, "Factory report — 2026-11", "<!-- factory:budget:2026-11 -->");

    expect(reportPlan([month], "2026-11-02")).toEqual({ action: "create", closes: [] });
  });

  it("closes every older weekly issue, not just the newest", () => {
    const older = issue(
      10,
      "Factory report: week of 2026-10-19",
      "<!-- factory-report:2026-10-19 -->",
    );
    const last = issue(
      11,
      "Factory report: week of 2026-10-26",
      "<!-- factory-report:2026-10-26 -->",
    );
    const current = issue(
      12,
      "Factory report: week of 2026-11-02",
      "<!-- factory-report:2026-11-02 -->",
    );

    expect(reportPlan([older, last, current], "2026-11-02")).toEqual({
      action: "edit",
      number: 12,
      closes: [10, 11],
    });
  });

  it("finds the week by its marker even when the title drifted", () => {
    const current = issue(13, "Factory report", "<!-- factory-report:2026-11-02 -->");

    expect(reportPlan([current], "2026-11-02")).toEqual({
      action: "edit",
      number: 13,
      closes: [],
    });
  });
});

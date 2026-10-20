import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE, KNEE_PROFILE } from "#config.ts";
import { HELP, parseArgs, parseSeconds, parseSecondsOrThrowArg } from "#args.ts";

const run = (argv: string[], env: Record<string, string | undefined> = {}) => {
  const parsed = parseArgs(argv, env);
  if (parsed.kind !== "run") throw new Error("expected a run");
  return parsed.options;
};

describe("load-test arguments", () => {
  it("defaults to the spec profile and the docker defaults", () => {
    const options = run([]);
    expect(options.profile).toEqual(DEFAULT_PROFILE);
    expect(options.knee).toBeNull();
    expect(options.httpPort).toBe(8_080);
    expect(options.prometheusPort).toBe(9_090);
    expect(options.projectName).toBe("universum-loadtest");
    expect(options.build).toBe(true);
    expect(options.keep).toBe(false);
    expect(options.endpoint).toBe("http://127.0.0.1:8080/colyseus");
    expect(options.warnings).toEqual([]);
  });

  it("scales the run down for a smoke", () => {
    const options = run(["--rooms", "20", "--ramp", "1m", "--hold", "2m"]);
    expect(options.profile.rooms).toBe(20);
    expect(options.profile.rampSeconds).toBe(60);
    expect(options.profile.holdSeconds).toBe(120);
    // A hold shorter than the spec's 20-minute restart keeps the middle.
    expect(options.profile.restartAfterHoldSeconds).toBe(60);
    expect(options.warnings).toEqual([
      "hold is shorter than 20m: restarting at the middle of the hold (60s)",
    ]);
  });

  it("takes an explicit restart offset into the hold", () => {
    const options = run(["--hold", "2m", "--restart-at", "30s"]);
    expect(options.profile.restartAfterHoldSeconds).toBe(30);
    expect(options.warnings).toEqual([]);
  });

  it("rejects a restart outside the hold", () => {
    expect(() => run(["--hold", "2m", "--restart-at", "3m"])).toThrow(
      /--restart-at must be within the 120s hold/,
    );
  });

  it("overrides the ports, project, endpoint and worker count", () => {
    const options = run([
      "--http-port",
      "9146",
      "--prometheus-port",
      "9190",
      "--grafana-port",
      "9300",
      "--project",
      "load-smoke",
      "--endpoint",
      "http://127.0.0.1:9146/colyseus",
      "--workers",
      "3",
      "--no-build",
      "--keep",
    ]);
    expect(options.httpPort).toBe(9_146);
    expect(options.prometheusPort).toBe(9_190);
    expect(options.grafanaPort).toBe(9_300);
    expect(options.projectName).toBe("load-smoke");
    expect(options.endpoint).toBe("http://127.0.0.1:9146/colyseus");
    expect(options.workers).toBe(3);
    expect(options.build).toBe(false);
    expect(options.keep).toBe(true);
  });

  it("reads the docker settings from the environment", () => {
    const options = run([], {
      LOADTEST_HTTP_PORT: "8046",
      LOADTEST_PROMETHEUS_PORT: "9046",
      LOADTEST_PROJECT: "from-env",
      LOADTEST_REPORT_DIR: "/tmp/reports",
      LOADTEST_ENDPOINT: "http://host.test/colyseus",
    });
    expect(options.httpPort).toBe(8_046);
    expect(options.endpoint).toBe("http://host.test/colyseus");
    expect(options.projectName).toBe("from-env");
    expect(options.reportDir).toBe("/tmp/reports");
  });

  it("turns on find-knee with its own profile", () => {
    const options = run(["--find-knee", "--max-rooms", "500"]);
    expect(options.knee).toEqual({ ...KNEE_PROFILE, maxRooms: 500 });
  });

  it("rejects invalid values", () => {
    expect(() => run(["--rooms", "0"])).toThrow(/--rooms/);
    expect(() => run(["--players", "5"])).toThrow(/--players/);
    expect(() => run(["--minute-limit", "20"])).toThrow(/--minute-limit/);
    expect(() => run(["--http-port", "70000"])).toThrow(/--http-port/);
    expect(() => run(["--workers", "0"])).toThrow(/--workers/);
    expect(() => run(["--nope"])).toThrow(/unknown option --nope/);
    expect(() => run(["--rooms"])).toThrow(/--rooms needs a value/);
  });

  it("ignores the bare -- that pnpm forwards", () => {
    expect(run(["--", "--rooms", "20"]).profile.rooms).toBe(20);
    expect(run(["--"]).profile.rooms).toBe(DEFAULT_PROFILE.rooms);
    expect(run(["--rooms", "20", "--"]).profile.rooms).toBe(20);
  });

  it("prints help", () => {
    const parsed = parseArgs(["--help"], {});
    expect(parsed.kind).toBe("help");
    expect(HELP).toContain("pnpm loadtest [--] [options]");
    expect(HELP).toContain("pnpm loadtest --rooms 20");
    expect(HELP).toContain("--find-knee");
  });
});

describe("duration parsing", () => {
  it.each([
    ["30s", 30],
    ["2m", 120],
    ["1.5m", 90],
    ["1h", 3_600],
    ["600", 600],
  ])("parses %s", (raw, seconds) => {
    expect(parseSeconds(raw)).toBe(seconds);
  });

  it.each(["", "1x", "-1m", "1m30"])("refuses %j", (raw) => {
    expect(parseSeconds(raw)).toBeNull();
  });

  it("names the argument in its error", () => {
    expect(() => parseSecondsOrThrowArg("--hold", "soon")).toThrow(
      "loadtest: --hold needs a duration like 30s, 10m or 2h",
    );
  });
});

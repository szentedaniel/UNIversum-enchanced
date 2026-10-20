import { describe, expect, it } from "vitest";
import { REPO_ROOT, composeArgs, composeEnv } from "#docker.ts";

const options = {
  httpPort: 8_080,
  prometheusPort: 9_090,
  grafanaPort: 3_000,
  projectName: "load-smoke",
};

describe("docker compose commands", () => {
  it("layers the load-test override with the monitoring profile", () => {
    const args = composeArgs(options, ["up", "-d", "--wait"]);
    expect(args.slice(0, 2)).toEqual(["compose", "-f"]);
    expect(args).toContain(`${REPO_ROOT}/compose.yaml`);
    expect(args).toContain(`${REPO_ROOT}/compose.loadtest.yaml`);
    expect(args).toContain("--profile");
    expect(args).toContain("monitoring");
    expect(args).toContain("--project-name");
    expect(args).toContain("load-smoke");
    expect(args.slice(-3)).toEqual(["up", "-d", "--wait"]);
  });

  it("passes the host ports and the build release through the environment", () => {
    expect(composeEnv(options, "abc1234")).toEqual({
      HTTP_PORT: "8080",
      PROMETHEUS_PORT: "9090",
      GRAFANA_PORT: "3000",
      RELEASE: "abc1234",
    });
  });
});

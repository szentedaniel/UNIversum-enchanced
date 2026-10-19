import { describe, expect, it } from "vitest";
import { loadConfig } from "#config.ts";

describe("loadConfig", () => {
  it("falls back to dev defaults when the environment sets nothing", () => {
    const config = loadConfig({});

    expect(config.port).toBe(2567);
    expect(config.host).toBe("127.0.0.1");
    expect(config.dataDir).toMatch(/apps[/\\]server[/\\]data$/);
  });

  it("takes every setting from the environment", () => {
    const config = loadConfig({ PORT: "3001", HOST: "0.0.0.0", DATA_DIR: "/var/lib/universum" });

    expect(config).toEqual({ port: 3001, host: "0.0.0.0", dataDir: "/var/lib/universum" });
  });

  it.each(["abc", "-1", "65536", "1.5", ""])("rejects PORT=%j", (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { claudeAgent, ompAgent } from "#shared/agents.ts";

const printCommand = (
  agent: AgentProvider,
  resumeSession?: string,
): { command: string; stdin?: string } =>
  agent.buildPrintCommand({
    prompt: "implement ticket 93",
    dangerouslySkipPermissions: true,
    ...(resumeSession === undefined ? {} : { resumeSession }),
  });

describe("ompAgent", () => {
  beforeEach(() => {
    process.env["OPENCODE_API_KEY"] = "test-key";
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-oauth-token";
  });
  afterEach(() => {
    delete process.env["OPENCODE_API_KEY"];
    delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
  });

  it("prints pi's JSON stream with omp as the binary and the deepseek model", () => {
    const { command, stdin } = printCommand(ompAgent());

    expect(command).toBe("omp -p --mode json --model 'opencode-go/deepseek-v4.1-flash:max'");
    expect(stdin).toBe("implement ticket 93");
  });

  it("keeps --session when Sandcastle resumes a session", () => {
    const { command } = printCommand(ompAgent(), "session-1");

    expect(command).toMatch(/^omp -p --mode json --model /);
    expect(command).toContain("--session 'session-1'");
  });

  it("is named omp and passes the opencode go key, with session capture off", () => {
    const agent = ompAgent();

    expect(agent.name).toBe("omp");
    expect(agent.captureSessions).toBe(false);
    expect(agent.env).toEqual({ OPENCODE_API_KEY: "test-key" });
  });

  it("launches omp for an interactive session too", () => {
    expect(
      ompAgent().buildInteractiveArgs?.({
        prompt: "",
        dangerouslySkipPermissions: true,
      }),
    ).toEqual(["omp", "--model", "opencode-go/deepseek-v4.1-flash:max"]);
  });
});

describe("claudeAgent", () => {
  beforeEach(() => {
    process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "test-oauth-token";
  });
  afterEach(() => {
    delete process.env["CLAUDE_CODE_OAUTH_TOKEN"];
  });

  it("runs Claude Code with the subscription's OAuth token", () => {
    const agent = claudeAgent("claude-opus-4-8");

    expect(agent.name).toBe("claude-code");
    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "test-oauth-token" });
    expect(printCommand(agent).command).toMatch(/^claude .*--model '?claude-opus-4-8'?/u);
  });

  it("bypasses permissions: a noSandbox run has no other flag to allow edits and Bash", () => {
    const { command } = printCommand(claudeAgent("claude-opus-4-8"));

    expect(command).toContain("--permission-mode bypassPermissions");
    expect(command).not.toContain("--dangerously-skip-permissions");
  });
});

import * as sandcastle from "@ai-hero/sandcastle";
import type { AgentProvider } from "@ai-hero/sandcastle";
import { required } from "#shared/common.ts";

/**
 * The opencode go subscription's DeepSeek flash: the `:max` suffix is the
 * effort level, so the provider gets no `thinking` option of its own.
 */
const OMP_MODEL = "opencode-go/deepseek-v4.1-flash:max";

/** omp is a pi fork: same binary CLI, same `--mode json` stream. */
const OMP_BINARY = "omp";

/**
 * Sandcastle's `pi()` with the binary swapped to omp. Only the leading `pi`
 * changes; every flag (`-p --mode json --model`, `--session <id>`) is pi's.
 */
export const ompAgent = (): AgentProvider => {
  const base = sandcastle.pi(OMP_MODEL, {
    captureSessions: false,
    env: { OPENCODE_API_KEY: required("OPENCODE_API_KEY") },
  });
  return {
    ...base,
    name: OMP_BINARY,
    buildPrintCommand(options) {
      const print = base.buildPrintCommand(options);
      return { ...print, command: print.command.replace(/^pi\b/u, OMP_BINARY) };
    },
    buildInteractiveArgs(options) {
      const args = base.buildInteractiveArgs?.(options) ?? [];
      return [OMP_BINARY, ...args.slice(1)];
    },
  };
};

/**
 * Claude Code on the owner's Pro subscription, for the judgement work. The
 * factory runs with `noSandbox()`, whose tag Sandcastle reads as "no sandbox"
 * and so passes no permission flag at all; `claude -p` would then deny every
 * edit and Bash call. The runner is an ephemeral VM, so the bypass is the
 * intended mode, as it is for Sandcastle's sandboxed runs.
 */
export const claudeAgent = (model: string): AgentProvider =>
  sandcastle.claudeCode(model, {
    permissionMode: "bypassPermissions",
    env: { CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN") },
  });

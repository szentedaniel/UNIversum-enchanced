import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads an environment variable the factory cannot run without; a missing one
 * is a misconfigured runner, never something to paper over.
 */
export const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

/**
 * A limit from the environment, else the default: an unset variable, a `0` or
 * a typo must not silently switch a limit off.
 */
export const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Where the workflow reads the failure comment's reason from. */
export const outputDir = (): string => process.env["OUTPUT_DIR"] ?? "/tmp";

/** Writes a file the workflow reads back from `OUTPUT_DIR`. */
export const writeOutput = (name: string, content: string): string => {
  const dir = outputDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

/** Fails the step, leaving the reason for the workflow's failure comment. */
export const fail = (message: string): never => {
  console.error(`\nFAILED: ${message}`);
  writeOutput("failure_reason.txt", message);
  process.exit(1);
};

/** A value as one POSIX shell word, for the arguments that are data (a title). */
export const shellArg = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

export const sh = (cmd: string): string =>
  execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** `sh`, but an empty string when the command fails. */
export const safeSh = (cmd: string): string => {
  try {
    return sh(cmd);
  } catch {
    return "";
  }
};

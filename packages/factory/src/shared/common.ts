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

/** Where the workflow reads the failure comment's reason from. */
export const outputDir = (): string => process.env["OUTPUT_DIR"] ?? "/tmp";

/** Fails the step, leaving the reason for the workflow's failure comment. */
export const fail = (message: string): never => {
 console.error(`\nFAILED: ${message}`);
 mkdirSync(outputDir(), { recursive: true });
 writeFileSync(join(outputDir(), "failure_reason.txt"), message);
 process.exit(1);
};

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

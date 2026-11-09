import { z } from "zod";

/**
 * The retro's structured answer, the one contract between the prompt and the
 * script: Claude finds the recurring problems and chooses each fix's home,
 * and the script performs the write. A `fix` is therefore a union — the kind
 * decides what the script may do, and `none` keeps a finding in the log
 * without opening anything.
 */
const issueFix = z.object({
  kind: z.literal("issue"),
  title: z.string().min(1),
  body: z.string().min(1),
});

const standardsFix = z.object({
  kind: z.literal("standards-pr"),
  title: z.string().min(1),
  body: z.string().min(1),
  patch: z.string().min(1),
});

const workflowFix = z.object({
  kind: z.literal("workflow-issue"),
  title: z.string().min(1),
  body: z.string().min(1),
  patch: z.string().min(1),
});

const noFix = z.object({ kind: z.literal("none") });

export const retroSchema = z.object({
  findings: z.array(
    z.object({
      problem: z.string().min(1),
      // What in the day's facts says this is real, not a guess.
      evidence: z.array(z.string().min(1)).min(1),
      severity: z.enum(["high", "medium", "low"]),
      fix: z.discriminatedUnion("kind", [issueFix, standardsFix, workflowFix, noFix]),
    }),
  ),
  // The dated log's bullets: what changed and why. `[]` on a quiet day.
  logEntry: z.array(z.string().min(1)),
});

export type Retro = z.infer<typeof retroSchema>;
export type Finding = Retro["findings"][number];
export type Fix = Finding["fix"];

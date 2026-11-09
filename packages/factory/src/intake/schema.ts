/**
 * The structured output the intake agents return, and the one check a split
 * plan must pass before the script writes anything.
 */
import { z } from "zod";

/**
 * The triage decision: a bug or small change is `ready` and carries the
 * Implementation context comment; an unclear issue is `needs-info` with the
 * questions; a feature is `spec` with the spec draft the owner approves.
 */
export const triageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), context: z.string().min(1) }),
  z.object({ kind: z.literal("needs-info"), questions: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("spec"), spec: z.string().min(1) }),
]);

export type Triage = z.infer<typeof triageSchema>;

/** A tracer-bullet ticket; `blockedBy` holds indices into the same ticket list. */
export const splitTicketSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  context: z.string().min(1),
  blockedBy: z.array(z.number().int()).default([]),
});

export const splitSchema = z.object({
  /** The approved spec, cleaned up for the parent issue's body. */
  spec: z.string().min(1),
  tickets: z.array(splitTicketSchema).min(1),
});

export type Split = z.infer<typeof splitSchema>;
export type SplitTicket = z.infer<typeof splitTicketSchema>;

/** One cycle in the dependency graph, as `0 → 1 → 0`, or `null`. */
const cyclePath = (tickets: readonly SplitTicket[]): number[] | null => {
  // 0 unvisited, 1 on the current path, 2 finished.
  const state = tickets.map(() => 0);
  const path: number[] = [];
  const visit = (index: number): number[] | null => {
    state[index] = 1;
    path.push(index);
    for (const dependency of tickets[index]?.blockedBy ?? []) {
      if (state[dependency] === 1) return [...path.slice(path.indexOf(dependency)), dependency];
      if (state[dependency] === 0) {
        const found = visit(dependency);
        if (found !== null) return found;
      }
    }
    path.pop();
    state[index] = 2;
    return null;
  };
  for (let index = 0; index < tickets.length; index += 1) {
    if (state[index] === 0) {
      const found = visit(index);
      if (found !== null) return found;
    }
  }
  return null;
};

/**
 * Why the plan cannot be written; empty when it can. Every `blockedBy` must
 * be an index into `tickets`, and the graph must be acyclic (a self-block is
 * the shortest cycle) — otherwise creating the edges would either fail halfway
 * or leave tickets that wait for each other forever.
 */
export const splitProblems = (split: Split): string[] => {
  const count = split.tickets.length;
  const problems: string[] = [];
  for (const [index, ticket] of split.tickets.entries()) {
    for (const blocked of ticket.blockedBy) {
      if (blocked < 0 || blocked >= count) {
        problems.push(
          `tickets[${String(index)}].blockedBy has ${String(blocked)}, outside 0..${String(count - 1)}`,
        );
      }
    }
    if (ticket.blockedBy.includes(index)) {
      problems.push(`tickets[${String(index)}] is blocked by itself`);
    }
  }
  if (problems.length > 0) return problems;
  const cycle = cyclePath(split.tickets);
  if (cycle !== null) {
    problems.push(`blockedBy forms a cycle: ${cycle.join(" → ")}`);
  }
  return problems;
};

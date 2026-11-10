import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_MARKER,
  architectureRun,
  DEFAULT_MAX_PROPOSALS,
  newProposals,
  proposalIssueBody,
  proposalLabel,
  type Proposal,
} from "#maintain/proposals.ts";

const twoWayDoor: Proposal = {
  title: "Deepen the dispatcher's frontier",
  problem: "The dispatcher reads six REST shapes around one pure rule.",
  proposal: "One `frontierOf` seam behind an adapter that fetches the facts.",
  files: ["packages/factory/src/dispatch/dispatch.ts", "packages/factory/src/dispatch/frontier.ts"],
  twoWayDoor: true,
  doorReason: "A revert restores the old fetch code; no state or wire format changes.",
};

const oneWayDoor: Proposal = {
  title: "Move the Playback clock into the rules package",
  problem: "Two clocks read the same timestamps from different places.",
  proposal: "One clock seam in the rules package, read by the Board.",
  files: ["packages/rules/src/playback.ts"],
  twoWayDoor: false,
  doorReason: "It changes the Playback contract the client and e2e tests read.",
};

describe("proposalLabel", () => {
  it("lets an agent take a two-way door and asks the owner for the rest", () => {
    expect(proposalLabel(twoWayDoor)).toBe("ready-for-agent");
    expect(proposalLabel(oneWayDoor)).toBe("ready-for-human");
  });
});

describe("proposalIssueBody", () => {
  it("carries the marker, the friction, the proposal, the files and the door", () => {
    const body = proposalIssueBody(twoWayDoor);

    expect(body.startsWith(`${ARCHITECTURE_MARKER}\n`)).toBe(true);
    expect(body).toContain(twoWayDoor.problem);
    expect(body).toContain(twoWayDoor.proposal);
    expect(body).toContain("- `packages/factory/src/dispatch/frontier.ts`");
    expect(body).toContain(`**Door:** two-way — ${twoWayDoor.doorReason}`);
  });

  it("calls a one-way door one-way", () => {
    expect(proposalIssueBody(oneWayDoor)).toContain(`**Door:** one-way — ${oneWayDoor.doorReason}`);
  });
});

describe("newProposals", () => {
  const tracked = (number: number, title: string, paths: string[] = []) => ({
    number,
    title,
    paths,
  });

  it("drops a proposal an open issue already carries, ignoring case and spacing", () => {
    const open = [tracked(120, "  deepen the DISPATCHER's frontier ")];

    expect(newProposals([twoWayDoor, oneWayDoor], open)).toEqual([oneWayDoor]);
  });

  it("drops a proposal whose module an open issue or pull request already names", () => {
    const trackedWork = [
      tracked(112, "Deepen the run-log reader", ["packages/factory/src/shared/runs.ts"]),
      tracked(135, "Implement #112", ["packages/factory/src/shared/runs.ts"]),
    ];
    const repeat = { ...twoWayDoor, files: ["packages/factory/src/shared/runs.ts"] };

    expect(newProposals([repeat, oneWayDoor], trackedWork)).toEqual([oneWayDoor]);
  });

  it("keeps a proposal whose modules none of the tracked work names", () => {
    const unrelated = [
      tracked(160, "GameRoom crash", ["apps/server/src/room/game-room.ts"]),
      tracked(164, "Implement #160", ["apps/server/src/room/game-room.ts"]),
    ];

    expect(newProposals([twoWayDoor, oneWayDoor], unrelated)).toEqual([twoWayDoor, oneWayDoor]);
  });

  it("keeps both when neither is tracked", () => {
    expect(
      newProposals([twoWayDoor, oneWayDoor], [tracked(141, "Red main: CI failed on 0b9af87")]),
    ).toEqual([twoWayDoor, oneWayDoor]);
  });
});

describe("architectureRun", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const proposal = {
    title: "Deepen the dispatcher's frontier",
    problem: "The dispatcher reads six REST shapes around one pure rule.",
    proposal: "One `frontierOf` seam behind an adapter that fetches the facts.",
    files: ["packages/factory/src/dispatch/frontier.ts"],
    twoWayDoor: true,
    doorReason: "A revert restores the old fetch code; no state or wire format changes.",
  };

  it("defaults to the picky weekly cap over the whole repository", () => {
    const config = architectureRun({}, now);

    expect(config.max).toBe(DEFAULT_MAX_PROPOSALS);
    expect(config.focus).toEqual([]);
    expect(config.promptArgs).toEqual({
      DATE: "2026-11-09",
      MAX_PROPOSALS: String(DEFAULT_MAX_PROPOSALS),
      CAP_RULE: expect.stringContaining("not a target"),
      FOCUS: "the whole repository",
    });
  });

  it("switches to the sweep rule when the owner lifts the cap", () => {
    const config = architectureRun(
      { MAX_PROPOSALS: "5", FOCUS: " packages/factory  apps/web " },
      now,
    );

    expect(config.max).toBe(5);
    expect(config.focus).toEqual(["packages/factory", "apps/web"]);
    expect(config.promptArgs.MAX_PROPOSALS).toBe("5");
    expect(config.promptArgs.CAP_RULE).toContain("sweep the owner asked for");
    expect(config.promptArgs.FOCUS).toBe("`packages/factory`, `apps/web`");
  });

  it("rejects a cap outside 1..20, naming the offending value", () => {
    for (const MAX_PROPOSALS of ["0", "21", "2.5", "many"]) {
      expect(() => architectureRun({ MAX_PROPOSALS }, now)).toThrow(
        `MAX_PROPOSALS must be an integer from 1 to 20, got '${MAX_PROPOSALS}'.`,
      );
    }
  });

  it("reads an unset or blank cap as the default", () => {
    expect(architectureRun({ MAX_PROPOSALS: "" }, now).max).toBe(DEFAULT_MAX_PROPOSALS);
    expect(architectureRun({ MAX_PROPOSALS: "  " }, now).max).toBe(DEFAULT_MAX_PROPOSALS);
  });

  it("bounds the schema by the run's cap", () => {
    const { schema } = architectureRun({ MAX_PROPOSALS: "4" }, now);

    expect(schema.safeParse({ proposals: Array.from({ length: 4 }, () => proposal) }).success).toBe(
      true,
    );
    expect(schema.safeParse({ proposals: Array.from({ length: 5 }, () => proposal) }).success).toBe(
      false,
    );
  });
});

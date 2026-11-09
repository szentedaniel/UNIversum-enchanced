import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_MARKER,
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
  it("drops a proposal an open issue already carries, ignoring case and spacing", () => {
    const open = ["  deepen the DISPATCHER's frontier "];

    expect(newProposals([twoWayDoor, oneWayDoor], open)).toEqual([oneWayDoor]);
  });

  it("keeps both when neither is tracked", () => {
    expect(newProposals([twoWayDoor, oneWayDoor], ["Red main: CI failed on 0b9af87"])).toEqual([
      twoWayDoor,
      oneWayDoor,
    ]);
  });
});

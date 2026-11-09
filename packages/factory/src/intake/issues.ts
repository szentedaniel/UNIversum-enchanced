/**
 * The REST issue list as the intake selection's facts. Pull requests come back
 * from the same endpoint and are kept so the selection can skip them.
 */
import { api, gh } from "#intake/gh.ts";
import type { IntakeIssue } from "#intake/select.ts";

interface ApiIssue {
  number: number;
  title: string;
  created_at: string;
  state: string;
  labels: { name: string }[];
  author_association: string;
  pull_request?: unknown;
  /** Present only on a sub-issue; the REST list omits it for top-level issues. */
  parent_issue_url?: string;
  /** Absent on the pull requests the same endpoint returns. */
  sub_issues_summary?: { total: number };
}

/** The parent's number out of `parent_issue_url`; `null` for a top-level issue. */
const parentOf = (url: string | undefined): number | null => {
  if (url === undefined) return null;
  const number = Number(url.split("/").at(-1));
  return Number.isInteger(number) ? number : null;
};

const factsOf = (issue: ApiIssue): IntakeIssue => ({
  number: issue.number,
  title: issue.title,
  createdAt: issue.created_at,
  state: issue.state,
  labels: issue.labels.map((label) => label.name),
  authorAssociation: issue.author_association,
  isPullRequest: issue.pull_request !== undefined,
  parent: parentOf(issue.parent_issue_url),
  subIssues: issue.sub_issues_summary?.total ?? 0,
});

/** Every open issue of the repo, pull requests included, as selection facts. */
export const openIssues = (repo: string): IntakeIssue[] =>
  api<ApiIssue>(`repos/${repo}/issues?state=open&per_page=100`).map(factsOf);

/** The issue as the split prompt's context. */
export interface IssueView {
  title: string;
  body: string;
  comments: string[];
}

interface IssueJson {
  title: string;
  body: string | null;
  comments: { body: string }[];
}

export const issueView = (number: number): IssueView => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `gh --json` prints GitHub's own shape, typed above
  const view = JSON.parse(
    gh(["issue", "view", String(number), "--json", "title,body,comments"]),
  ) as IssueJson;
  return {
    title: view.title,
    body: view.body ?? "",
    comments: view.comments.map((comment) => comment.body),
  };
};

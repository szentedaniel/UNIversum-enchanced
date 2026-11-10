#!/usr/bin/env bash
# Creates the factory's schedule on cron-job.org: one job per scheduled
# workflow, each a `workflow_dispatch` call to GitHub at the cron's time.
# GitHub's own cron starts this repository's runs hours late or drops them;
# these jobs fire on time, and every workflow tolerates a second run.
#
# Needs, read without echo so neither lands in a log or a transcript:
#   - a cron-job.org API key (Console → Settings → API);
#   - a fine-grained GitHub token for this repository only, with the
#     repository permission "Actions: Read and write" and nothing else.
#
# Re-running is safe: a job whose title already exists is left alone.
# Usage: bash packages/factory/scripts/cron-job-org.sh
set -euo pipefail

REPO="szentedaniel/UNIversum-enchanced"
API="https://api.cron-job.org"

read -rsp "cron-job.org API key: " CRON_KEY && echo
read -rsp "GitHub token (Actions read/write on $REPO): " GH_DISPATCH_TOKEN && echo

# title | workflow file | inputs JSON | timezone | hours | minutes | wdays
JOBS=(
  "factory intake|factory-intake.yml|{}|UTC|[0]|[7]|[-1]"
  "factory review queue|factory-review.yml|{}|UTC|[1]|[23]|[-1]"
  "factory retro|factory-retro.yml|{}|UTC|[3]|[41]|[-1]"
  "factory maintain|factory-maintain.yml|{\"scheduled\":\"true\"}|UTC|[2]|[19]|[0]"
  "factory report|factory-report.yml|{}|Europe/Budapest|[6]|[9]|[1]"
  "factory dispatch|factory-dispatch.yml|{}|UTC|[-1]|[43]|[-1]"
)

existing=$(curl -fsS "$API/jobs" -H "Authorization: Bearer $CRON_KEY" | jq -r '.jobs[].title')

for line in "${JOBS[@]}"; do
  IFS='|' read -r title workflow inputs timezone hours minutes wdays <<< "$line"
  if grep -qxF "$title" <<< "$existing"; then
    echo "exists: $title"
    continue
  fi
  body=$(jq -cn --argjson inputs "$inputs" '{ref: "main", inputs: $inputs}')
  job=$(jq -n \
    --arg title "$title" \
    --arg url "https://api.github.com/repos/$REPO/actions/workflows/$workflow/dispatches" \
    --arg token "Bearer $GH_DISPATCH_TOKEN" \
    --arg body "$body" \
    --arg timezone "$timezone" \
    --argjson hours "$hours" --argjson minutes "$minutes" --argjson wdays "$wdays" \
    '{job: {
        title: $title, url: $url, enabled: true, saveResponses: true,
        requestMethod: 1,
        schedule: {timezone: $timezone, expiresAt: 0, hours: $hours, minutes: $minutes,
                   mdays: [-1], months: [-1], wdays: $wdays},
        extendedData: {
          headers: {
            "Authorization": $token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "universum-factory-cron"
          },
          body: $body
        },
        notification: {onFailure: true, onFailureCount: 2, onSuccess: false, onDisable: true}
      }}')
  id=$(curl -fsS -X PUT "$API/jobs" -H "Authorization: Bearer $CRON_KEY" \
    -H "Content-Type: application/json" -d "$job" | jq -r .jobId)
  echo "created: $title (job $id)"
  # Creating is limited to five a minute.
  sleep 13
done

echo "Done. Check each job's first run in the cron-job.org console (GitHub answers 204)."

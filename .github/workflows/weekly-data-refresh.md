---
on:
  schedule: weekly on sunday
  workflow_dispatch:

engine: copilot

# Personal-repository Copilot authentication uses the COPILOT_GITHUB_TOKEN
# repository secret with Account permission "Copilot Requests: Read".
permissions:
  contents: read

# Exact external source hosts currently cited by data/costs.v1.json.
# Custom domains require strict mode to be disabled.
strict: false
network:
  allowed:
    - defaults
    - "www.idealista.com"
    - "welovexabia.com"
    - "www.numbeo.com"
    - "universitats.gva.es"
    - "web.ua.es"
    - "www.immobiliare.it"
    - "livingcost.org"
    - "unige.it"
    - "livingwage.mit.edu"
    - "www.huduser.gov"
    - "admit.washington.edu"
    - "www.seattleschools.org"

tools:
  edit:
  web-fetch:
  github:
    toolsets: [repos]
    min-integrity: approved

steps:
  - name: Install locked Node dependencies
    run: npm ci

post-steps:
  - name: Reject changes outside the cost-data file
    shell: bash
    run: |
      set -euo pipefail
      changed_files="$(git diff --name-only "$GITHUB_SHA" --)"
      if [ "$changed_files" != "data/costs.v1.json" ]; then
        echo "Expected only data/costs.v1.json to change; got:"
        printf '%s\n' "$changed_files"
        exit 1
      fi

  - name: Run tests against the proposed data
    run: npm test

  - name: Validate candidate against the trigger baseline
    shell: bash
    run: |
      set -euo pipefail
      baseline="${RUNNER_TEMP}/costs.v1.baseline.json"
      git show "${GITHUB_SHA}:data/costs.v1.json" > "$baseline"
      node scripts/validate-data.mjs \
        data/costs.v1.json \
        --baseline "$baseline"

safe-outputs:
  staged: true
  create-pull-request:
    draft: true
    max: 1
    fallback-as-issue: false
    allowed-files:
      - data/costs.v1.json
---

# Weekly family-cost data refresh

Refresh only `data/costs.v1.json`.

## Allowed research sources

Fetch information only from the currently cited source hosts configured in
`network.allowed`. Do not use search engines, alternate sources, source mirrors,
or any URL outside that allowlist. Do not bypass paywalls, access controls,
robots restrictions, rate limits, or anti-bot protections.

If an allowed source is inaccessible, ambiguous, stale, or does not provide
sufficient evidence, retain the existing related value and citation. Never
replace valid checked-in data with a guess.

## Required data rules

1. Preserve the JSON schema version, three fixed cities, household composition,
   currencies, item IDs, and every required schema field.
2. Every adopted default must retain at least one valid cited source.
3. Use only HTTPS source URLs.
4. Keep source reliability and uncertainty notes accurate. Official sources
   outrank portals and crowd-sourced estimates.
5. Do not introduce a new source host.
6. Do not include university living-at-home allowances in household housing,
   food, transport, healthcare, or other-household values.
7. Do not change any file other than `data/costs.v1.json`.
8. Make no change when the available evidence does not justify one.

The workflow rejects changes outside the data file, runs the repository tests,
and validates the proposed data against the exact triggering revision. The safe
output is staged, so it previews one draft PR rather than creating it. After
reviewing successful previews, change `staged: true` to `staged: false`.

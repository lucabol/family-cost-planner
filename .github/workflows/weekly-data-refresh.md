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
  - name: Install pinned ripgrep
    shell: bash
    run: |
      set -euo pipefail
      version="14.1.1"
      archive="ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz"
      checksum="4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e"
      base_url="https://github.com/BurntSushi/ripgrep/releases/download/${version}"
      curl --fail --location --silent --show-error \
        "${base_url}/${archive}" \
        --output "${RUNNER_TEMP}/${archive}"
      echo "${checksum}  ${RUNNER_TEMP}/${archive}" | sha256sum --check
      tar --extract --gzip --file "${RUNNER_TEMP}/${archive}" --directory "${RUNNER_TEMP}"
      mkdir -p "${RUNNER_TEMP}/bin"
      install -m 0755 \
        "${RUNNER_TEMP}/ripgrep-${version}-x86_64-unknown-linux-musl/rg" \
        "${RUNNER_TEMP}/bin/rg"
      echo "${RUNNER_TEMP}/bin" >> "${GITHUB_PATH}"

  - name: Install locked Node dependencies
    run: npm ci

post-steps:
  - name: Reject changes outside the cost-data file
    shell: bash
    run: |
      set -euo pipefail
      changed_files="$(git diff --name-only "$GITHUB_SHA" --)"
      if [ -z "$changed_files" ]; then
        echo "No evidence-backed data changes were proposed."
      elif [ "$changed_files" != "data/costs.v1.json" ]; then
        echo "Expected only data/costs.v1.json to change; got:"
        printf '%s\n' "$changed_files"
        exit 1
      fi

  - name: Run tests against the proposed data
    run: npm test

  - name: Flag candidate changes above weekly thresholds
    continue-on-error: true
    shell: bash
    run: |
      set -euo pipefail
      baseline="${RUNNER_TEMP}/costs.v1.baseline.json"
      git show "${GITHUB_SHA}:data/costs.v1.json" > "$baseline"
      node scripts/validate-data.mjs \
        data/costs.v1.json \
        --baseline "$baseline"

safe-outputs:
  staged: false
  threat-detection:
    steps:
      - name: Install pinned ripgrep
        shell: bash
        run: |
          set -euo pipefail
          version="14.1.1"
          archive="ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz"
          checksum="4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e"
          base_url="https://github.com/BurntSushi/ripgrep/releases/download/${version}"
          curl --fail --location --silent --show-error \
            "${base_url}/${archive}" \
            --output "${RUNNER_TEMP}/${archive}"
          echo "${checksum}  ${RUNNER_TEMP}/${archive}" | sha256sum --check
          tar --extract --gzip --file "${RUNNER_TEMP}/${archive}" --directory "${RUNNER_TEMP}"
          mkdir -p "${RUNNER_TEMP}/bin"
          install -m 0755 \
            "${RUNNER_TEMP}/ripgrep-${version}-x86_64-unknown-linux-musl/rg" \
            "${RUNNER_TEMP}/bin/rg"
          echo "${RUNNER_TEMP}/bin" >> "${GITHUB_PATH}"
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
7. Classify every evidence entry as either `comparable` or `excluded`. An
   exclusion must include the schema-defined reason code and a specific
   explanation. Exclude wrong household sizes, overlapping bundles, different
   housing or item scopes, qualitative-only citations, and values lacking
   correct monthly normalization. Never omit evidence silently.
8. For every item, run `npm run apply:defaults` after evidence changes. The
   adopted default must remain the highest normalized value or range upper
   bound among comparable evidence. Never manually reduce or discard the
   highest candidate.
9. If only one comparable source supports an item, retain its highest value and
   keep the generated `single-source-low-confidence` flag. If one uniquely
   highest candidate is more than 25% above the next-highest comparable source,
   retain it and keep the generated `singleton-outlier` review flag. Never
   exclude an outlier automatically.
10. Do not change any file other than `data/costs.v1.json`.
11. Make no change when the available evidence does not justify one.

The workflow rejects changes outside the data file, runs the repository tests,
enforces the default-selection policy, and compares the proposal with the exact
triggering revision. Weekly threshold breaches remain visible in the run and
the safe output stays a draft PR for explicit human review; the workflow never
writes directly to `main`.

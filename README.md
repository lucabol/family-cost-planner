# Family Cost Planner

A public, client-side budget planner for a four-person household comparing [Jávea/Xàbia](https://lucabol.github.io/family-cost-planner/), Savona, and Seattle.

**Live site:** https://lucabol.github.io/family-cost-planner/

## Architecture

- `index.html`, `styles.css`, and `app.js` form a static GitHub Pages site. Editing, totals, local persistence, reset, contingency, and JSON export all run in the browser.
- `data/costs.v1.json` contains checked-in adopted defaults and source evidence. The page does not fetch third-party sites.
- `schema/cost-data.schema.json` plus `scripts/validate-data.mjs` reject malformed data, missing citations, invalid values, unknown model entities, inverted ranges, unsafe overlap, and implausible weekly changes.
- GitHub-hosted automation researches or proposes updates to the checked-in JSON. Personal scenario values are never sent to GitHub.

## Local use

Node.js 22 or newer is recommended.

```bash
npm ci
npm test
npm run validate:data
npx serve .
```

Open the local URL printed by `serve`. Opening `index.html` directly is not supported because browsers block JSON `fetch` from `file:` URLs.

## Weekly refresh and safety

`.github/workflows/weekly-data-refresh.md` is the human-authored GitHub Agentic Workflow. Its compiled `.lock.yml` is the executable workflow. Every Sunday it may research only the explicitly allowlisted source hosts, edit only `data/costs.v1.json`, and produce at most one draft pull request. It cannot push directly to `main`.

Deterministic post-steps run the test suite and compare the candidate with the exact trigger revision. Weekly changes above 15% for adopted defaults or 25% for normalized evidence are blocked. Failed, inaccessible, or ambiguous sources retain the last-known-good value. University living-at-home allowances cannot be added to household housing, food, or transport.

The separate `Validate cost data` workflow runs on changes, manually, and every Sunday as a deterministic health check. It validates known-good data but does not claim to research new values.

## One-time agentic workflow setup

GitHub Agentic Workflows are in public preview. For this personal public repository:

1. Create a fine-grained personal access token with account permission **Copilot Requests: Read**.
2. Save it as the repository Actions secret `COPILOT_GITHUB_TOKEN`.
3. Install the tooling with `gh extension install github/gh-aw`.
4. After editing workflow frontmatter, run `gh aw compile --strict` and `gh aw validate --strict`, then commit both the Markdown source and generated lock file.
5. Review and merge the draft PR produced by a successful refresh; retain required checks and human merge review.

No GitHub App is required. Organization-owned repositories can instead enable organization-billed Copilot CLI and grant `copilot-requests: write`.

## Manual refresh fallback

Run **Actions → Propose manual data refresh → Run workflow** and paste the complete candidate JSON. The workflow performs deterministic validation and opens a draft PR. Candidates that exceed weekly thresholds are explicitly titled for manual review rather than silently published.

From the CLI:

```bash
gh workflow run manual-data-refresh.yml -f candidate_json="$(cat candidate.json)"
```

## GitHub Pages

`.github/workflows/pages.yml` uses the official `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages` actions. It deploys changes from `main` and supports manual dispatch. Repository Pages must use **GitHub Actions** as its build source.

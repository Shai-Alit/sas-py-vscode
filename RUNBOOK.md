# sas-py-vscode — Maintainer Runbook (Punch List)

Companion to `PRODUCTION_PLAN.md`. The plan says *what and why*; this says
*which commands, in what order, and who runs them*.

> **Legend**
> ☐ = a manual step **you** perform.
> 🤖 = prepared for you in the working copy — no action from you until the ☐ that follows.

**Why the split.** The dev sandbox has no push access, no `gh` credentials, and
no SSH keys for your repos. So the agent writes code, tests, docs, and scoped
commits in the working copy; you push, open PRs, and merge. Every phase ends with
a prepared branch plus a handoff containing the exact `git push` / `gh pr create`
commands and a PR description.

---

## Section A — One-time repo setup

Run once, before Phase 0a.

```bash
cd /c/Users/seford/git/GitHub/sas-py-vscode
git status                      # confirm clean, on main
gh repo view --json name,defaultBranchRef,visibility
```

☐ **A1.** Confirm `main` is the default branch.

☑ **A2. Done 2026-08-12.** Branch protection on `main`: required status checks
(added after 0d-i-b — see the 0d-i section), linear history, no force pushes, no
deletions, conversation resolution required. The AI reviewers are **out** of the
required checks; they are advisory and comment-only.

☑ **A3. Done 2026-08-12.** The repo is squash-merge only, with "delete branch on
merge" on. This is what keeps history linear and matches viyapy. It did not take
the first time — see the note in the 0d-i section — so verify rather than assume:

```bash
gh repo edit --enable-squash-merge --enable-merge-commit=false \
             --enable-rebase-merge=false --delete-branch-on-merge

gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge
```

☐ **A4.** Settle the Phase 0 open decisions from `PRODUCTION_PLAN.md` §6. These
bake into `LICENSE` and `package.json` and are painful to change later:

- ☑ **#0 Repository licence** — **settled 2026-08-11: Apache-2.0.** Executed in 0a.
- ☑ **#1 Extension identifier and display name** — **settled 2026-08-12:
  "Python on Viya", id `python-on-viya`.** ADR-0001. Executed in 0b.
- ☑ **#2 Configuration namespace** — **settled 2026-08-12: `pythonOnViya.*`.**
  ADR-0001. The provisional `SASPY.*` was withdrawn: `saspy` is SAS's own official
  Python-to-SAS package. Executed in 0b.
- ☑ **#3 Workspace-trust posture** — **settled 2026-08-12: `"limited"`.** ADR-0002.
  Executed in 0b.
- ☑ **#4 Web/browser target** — **settled 2026-08-12: node-only**, revisitable at
  Phase 6+. ADR-0003. Executed in 0b.
- ☑ **#6 Coverage threshold** — **settled 2026-08-12: measure, then ratchet.** The
  honest baseline in 0c is **0%**: the only shipped module is the activation entry
  point, it imports `vscode`, and the unit tier cannot load it. Thresholds live in
  `.c8rc.json`, go up and never down, and **a slice that adds code to `src/` raises
  them in the same pull request**. See `docs/dev/testing.md`.
  **Amended 2026-08-13 by ADR-0009:** the denominator is unit-reachable code — a
  module is excluded **if and only if it imports `vscode`**, checked on every
  `npm run verify`. The vendored-generated-client exemption recorded here on
  2026-08-12 is superseded. **ADR-0010 (2026-08-14) then closed the question
  outright:** the Compute client is hand-written, so there is no generated client
  to exclude. See the Phase 2 section below.

---

## Section B — The per-slice loop

Every slice follows this. It is the same loop viyapy uses.

### B1 — Cut the branch

```bash
git checkout main && git pull --ff-only && git checkout -b phase-<slice>-<slug>
```

> **Why this is one chained line.** It used to be two lines, and that cost a
> rebase on slice 0b. `git pull` aborted — local edits would have been
> overwritten — but the next line ran anyway and cut the branch from a stale
> `main`. The slice was built, committed, pushed, and a PR opened before anyone
> noticed, and the PR diff duplicated three files that had already merged.
> `&&` stops the sequence dead, and `--ff-only` refuses to paper over divergence
> with a merge commit. Do not split this back into separate lines.

🤖 **Implement.** Agent writes code + tests + fixtures + docs + `CHANGELOG.md`
entry under `[Unreleased]`, in scoped Conventional Commits.

### B2 — Push, review, merge

```bash
git add -A
git commit -m "<type>(<scope>): <summary>"
git push -u origin phase-<slice>-<slug>
gh pr create --base main --head phase-<slice>-<slug> --fill
```

☐ Wait for CI green **and** both AI reviewers to post.
☐ Address feedback (🤖 agent prepares fixes; you push).
☐ Merge:

```bash
gh pr merge --squash --delete-branch
```

> **⛔ Merge barrier.** Slices within a phase are sequential. The
> `git pull --ff-only` at the top of the next slice only picks up the previous
> one if that PR is **already merged**. Do not batch-run these blocks — and if a
> pull fails, stop and fix it rather than running the rest of the block.

### Conventions

- **Branches**: `phase-<slice>-<slug>`, where `<slice>` is the slice label exactly as
  the plan writes it — `phase-3a-proc-python-backend`, `phase-0d-i-a-core-ci`,
  `phase-3d-ii-result-panel`, `phase-2-pre-submission-probe`.
  Non-phase work: `fix/<slug>`, `docs/<slug>`, `chore/<slug>`, `ci/<slug>`.
- **Commits**: Conventional Commits — `feat|fix|docs|test|chore|refactor|ci`.
  Scopes: `auth`, `compute`, `backend`, `dialects`, `python`, `content`,
  `library`, `cas`, `notebook`, `ci`.
- **Skip AI review** on trivial/meta commits with `[skip-review]` in the head
  commit message, or the `no-ai-review` label.

---

## Section C — Phase punch lists

### Phase 0 — Repository foundation

> **Do 0a first and alone.** `.gitattributes` must land before any other file so
> line-ending normalisation applies to everything that follows. Dev is Windows,
> CI is Linux; getting this wrong pollutes every later diff.

☑ **Open decision #0 settled 2026-08-11: Apache-2.0.** 0a replaces `LICENSE`, adds
`NOTICE`, and records the rationale in ADR-0000. It also copies `PROBE-FINDINGS.md`
into the repo and stands up the `docs/` skeleton (`PRODUCTION_PLAN.md` §4.1).

```bash
# 0a — scaffold, hygiene, and licensing
git checkout main && git pull --ff-only && git checkout -b phase-0a-scaffold
#   … 🤖 implement 0a …
git add -A
# hold back files that belong to later slices, not to 0a
git reset .github/workflows/claude-review.yml .github/workflows/ai-review.yml .github/scripts/ai_review.py test/scratch/
git commit -m "chore: relicense to Apache-2.0 and add repo scaffold, hygiene files, and NOTICE"
git push -u origin phase-0a-scaffold
gh pr create --base main --head phase-0a-scaffold --fill
```

> **Why the `git reset`.** The reviewer workflows and the Section E smoke-test
> fixture are already sitting in the working copy so that 0a-ii and the smoke test
> are pure `git add`s with nothing left to author. A bare `git add -A` would
> swallow them into 0a — collapsing two slices into one and losing the bootstrap
> gate below, and worse, committing deliberately vulnerable code to `main`.
> Untracked files survive branch switches, so both are picked up later unchanged.

⛔ Merge 0a before 0a-ii.

```bash
# 0a-ii — AI reviewer bootstrap (files already prepared in .github/)
git checkout main && git pull --ff-only && git checkout -b phase-0a-ii-ai-reviewers
git add .github/workflows/claude-review.yml .github/workflows/ai-review.yml .github/scripts/ai_review.py
git commit -m "ci: add Claude and Codex PR reviewer workflows"
git push -u origin phase-0a-ii-ai-reviewers
gh pr create --base main --head phase-0a-ii-ai-reviewers --fill
```

> **Expected on the 0a-ii PR itself: neither reviewer will post a review.** For a
> same-repo `pull_request` event GitHub runs the workflow files *from the PR head*,
> so both jobs genuinely execute — they just can't succeed yet. The Codex workflow
> deliberately checks out `base.sha`, where `ai_review.py` does not exist on `main`
> yet, so it has nothing to run. That much is the bootstrap gate, and it only bites
> once.
>
> **A red X on the Claude job here is *not* the gate — investigate it.** That job
> reaches `azure/login` on every PR, so any failure there is a real configuration
> defect that would recur on 0b and every slice after. Read the error rather than
> waving it through; see the AADSTS700213 note in Section E.

☐ Merge 0a-ii, then run the **Section E smoke test**. Do not start 0b until both
bots have demonstrably posted on the smoke-test PR — if they're broken, you want
to know now, not after four more slices have merged unreviewed.

⛔ Merge 0a-ii and pass the smoke test before 0b.

```bash
# 0b — TypeScript toolchain
git checkout main && git pull --ff-only && git checkout -b phase-0b-toolchain
#   … 🤖 implement 0b …
git add -A && git commit -m "chore(ci): add TypeScript toolchain, lint, and bundling"
git push -u origin phase-0b-toolchain
gh pr create --base main --head phase-0b-toolchain --fill
```
⛔ Merge 0b before 0c.

```bash
# 0c — test harness
git checkout main && git pull --ff-only && git checkout -b phase-0c-test-harness
#   … 🤖 implement 0c …
git add -A && git commit -m "test: add mocha/test-electron harness and HTTP mocking layer"
git push -u origin phase-0c-test-harness
gh pr create --base main --head phase-0c-test-harness --fill
```
☑ **Coverage starting threshold set** (open decision #6, settled above): 0%,
which is what the suite honestly measures, plus the ratchet rule that makes the
number climb. The exclusion policy written here in 0c — vendored generated
OpenAPI clients — was **superseded on 2026-08-13 by ADR-0009**, which excludes a
module if and only if it imports `vscode`. Left in place as the record of what 0c
actually did.

☐ **From here on, every slice that adds code to `src/` raises the thresholds in
`.c8rc.json` in the same pull request** — run `npm run coverage`, read the
summary table, round down, commit. This line is the ratchet; without it the
starting number of 0 is where coverage stays.

☑ **`npm run test:integration` run locally, 2026-08-12** — 3 passing, exit code 0,
against a freshly downloaded VS Code 1.133.0 on win32-x64. This tier cannot run
in a headless agent sandbox, so it was wired and type-checked blind; running it
once here confirmed the two-halves runner, the discovery, the activation
contract, and command registration all work against a real editor.

☑ **Running the integration tier breaks `npm run lint` — fixed 2026-08-12.**
`.vscode-test/` is git-ignored, ESLint flat config does not read `.gitignore`,
and linting a gigabyte of downloaded VS Code exhausts the V8 heap. Found by
running the tiers in the order a contributor would. If `npm run lint` ever dies
with *"FATAL ERROR: Reached heap limit"* rather than reporting a rule violation,
suspect a newly generated directory missing from the ignores block, not a rule.

⚠️ **Run `npm ci` first if the agent has run `npm install` against this checkout.**
The sandbox is Linux and your shell is Windows; they share the working tree, so
`node_modules` ends up holding the wrong esbuild binary and `npm run build` fails
before any test runs. This is a stale install, not a broken build. The lockfile
carries every platform, so `npm ci` is always enough.

⛔ Merge 0c before 0d-i-a.

```bash
# 0d-i-a — core CI and packaging
git checkout main && git pull --ff-only && git checkout -b phase-0d-i-a-core-ci
#   … 🤖 implement 0d-i-a …
git add -A && git commit -m "ci: add lint, type-check, test matrix, and vsix packaging"
git push -u origin phase-0d-i-a-core-ci
gh pr create --base main --head phase-0d-i-a-core-ci --fill
```

☑ **Done 2026-08-12, after 0d-i-b merged.** Required status checks added to
branch protection (deferred from A2 — they can only be selected once they have
reported). **Nine** of them, not four: `verify`, `docs`, `package`, and all six
legs of `test`, because the matrix job is named
`test (${{ matrix.os }}, node ${{ matrix.node }})` and required checks are named
per reported check. Adding an OS or a Node version therefore creates a check that
is **not** required until someone adds it here — re-run the `PUT` below after any
matrix change.

☐ **Amended 2026-08-13, after `changes` was added.** Make it **ten**: `changes`
must be required too, and this one is load-bearing rather than tidy. `verify`,
`package` and the six `test` legs now carry `needs: changes`, so if the classify
step ever fails — a transient `git fetch`, a bad minute at GitHub — those eight
jobs are *skipped* rather than failed, and GitHub counts a skipped required
check as passing. That is the same property the docs-only path deliberately relies on,
and it does not distinguish why a job was skipped. Without `changes` in this
list there is a live path from an infrastructure blip to a pull request that
merges green having run only `docs`.

Making `changes` required closes it, because then its own failure blocks the
merge directly instead of cascading into skips. The alternative — never letting
the job fail, by defaulting to `code=true` on error — was rejected: a job that
cannot fail cannot tell you it is broken.

Set with the contexts derived from what actually reported, so a typo cannot
create a required check that never runs:

```bash
CONTEXTS=$(gh api repos/Shai-Alit/sas-py-vscode/commits/main/check-runs \
  --jq '[.check_runs[].name] | unique | tostring')

gh api -X PUT repos/Shai-Alit/sas-py-vscode/branches/main/protection --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": $CONTEXTS },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

Three judgement calls worth knowing before you change any of them:

- `required_pull_request_reviews` is **null**. There is one human on this
  repository and the AI reviewers cannot approve, so requiring an approval would
  lock the only maintainer out. Revisit when there is a second contributor.
- `enforce_admins` is **false**, deliberately: required checks otherwise block
  direct pushes to `main` with no way round it. The guard is a seatbelt, not a
  lock.
- GitHub pinned every context to `app_id 15368` (GitHub Actions), so another app
  or a token cannot satisfy `verify` by posting a green status of the same name.
  That is stronger than the plain `contexts` list looks, and it is why the two
  AI reviewers — which run only on `pull_request` and so never reported on
  `main` — could not have been swept into the requirement by accident.

☑ **Squash-merge is not actually enforced yet.** PR #6 landed as a merge commit,
so either A3's `gh repo edit` was not run or the setting was overridden at merge
time. Re-run it before the history gets any longer:

```bash
gh repo edit --enable-squash-merge --enable-merge-commit=false \
             --enable-rebase-merge=false --delete-branch-on-merge
```

```bash
# 0d-i-b — docs CI
git checkout main && git pull --ff-only && git checkout -b phase-0d-i-b-docs-ci
#   … 🤖 implement 0d-i-b …
git add -A && git commit -m "ci: generate the settings and command reference and gate docs"
git push -u origin phase-0d-i-b-docs-ci
gh pr create --base main --head phase-0d-i-b-docs-ci --fill
```

☑ **Settled 2026-08-12: the generated reference is committed**, so 0d-i-b must
also drop `docs/reference/` from `.gitignore`. See PRODUCTION_PLAN.md §4.1 —
the plan wanted CI to fail on a diff against a file `.gitignore` was keeping out
of the repo, and only one of those could survive.

☑ **Settled 2026-08-12, in 0d-i-b: VitePress; external links swept weekly, not
gated on PRs; links back into this repository resolved against the working tree
and gated; TypeDoc deferred until there is an exported API.** Recorded as
[ADR-0004](docs/adr/0004-documentation-toolchain.md); summarised in
PRODUCTION_PLAN.md §4.1. The short version: VitePress fails its own build on
dead internal links, so the link gate rides along with a build we already run,
and external rot is somebody else's outage rather than a reason to redden a PR.

☑ **0d-ii split into 0d-ii-a and 0d-ii-b, 2026-08-12.** Same reasoning that split
0d-i: the supply-chain half is a policy decision backed by an experiment, the
scanning half is largely workflow wiring, and a reviewer should not have to hold
both at once.

```bash
# 0d-ii-a — supply chain (audit gate + install-script policy)
git checkout main && git pull --ff-only && git checkout -b phase-0d-ii-a-supply-chain
#   … 🤖 implement 0d-ii-a …
git add -A && git commit -F .git/COMMIT_0D_II_A.txt   # message written 2026-08-12
git push -u origin phase-0d-ii-a-supply-chain
gh pr create --base main --head phase-0d-ii-a-supply-chain --fill
```

☑ **Settled 2026-08-12: all six advisories are unfixable, so the gate cannot fail
on the dev tree as it stands.** Measured, not assumed. `mocha@11.8.0` is the
latest stable and still depends on `diff@^7.0.0` and `serialize-javascript@^6.0.2`,
both inside the vulnerable ranges; mocha 12 is only at `rc.6`. `npm audit fix
--force` proposes mocha@11.3.0, which is a **downgrade** from what is installed
and fixes nothing. `vitepress@1.6.4` is latest and pins `vite@^5.4.14` → `esbuild@0.21.5`;
the only escape is `vitepress@2.0.0-alpha.19`. Re-check before assuming any of
this is still true.

☑ **Settled 2026-08-12: the gate is hard on production, allow-listed on dev.**
`npm audit --omit=dev` fails at any severity — vacuous today, because the
production tree is empty, but it is the real gate the day a runtime dependency
lands. Dev advisories fail too unless they appear in a dated allow-list with an
expiry, so a pull request that introduces a *new* one goes red at the moment it
does it. The 3 → 6 jump in 0d-i-b, which came purely from adding VitePress, is
the case this is built for: a gate on the raw total ratchets upward every time a
dev tool lands and gets switched off within a month.

☑ **Corrected 2026-08-12 after PR review: a failed audit was reading as a clean
one.** Measured — `npm audit --json --registry=http://127.0.0.1:1` prints
`{"message": "… connect ECONNREFUSED …", "error": {…}}` and exits **0**. So the
exit code is useless in both directions (non-zero when the audit worked and found
something, zero when it never ran) and the parse succeeds either way. With no
`vulnerabilities` key the report read as an empty map and the production rule —
the one with no allow-list — printed "clean". `runAudit` now validates the shape
of the report and exits **2**, so a network failure is never filed as a security
finding. The same review, and the Codex reviewer independently, caught that
`execFileSync` had no timeout; both audits now run under a two-minute one, per
`CONTRIBUTING.md`'s rule that every network call has a timeout and an abort path.

☑ **Settled 2026-08-12: deny every install script.** This reverses what this
runbook previously assumed. `@vscode/vsce-sign`, `esbuild` (0.28.2 and 0.21.5),
`keytar` and `msw` are all deniable, proven by running the real commands with
them blocked: 70 unit tests pass, and `npm run build`, `npm run docs:build`
and `npm run package` all succeed.

**Corrected 2026-08-12 after PR review: the deny-list was missing `fsevents`,**
which the lockfile also marks `hasInstallScript`. Six lockfile entries, five
package names — `esbuild` appears twice. It was missed because it is optional and
`os: ["darwin"]`, so it never installs on the machine the list was written on,
and the `supply-chain` job runs on `ubuntu-latest` and so can never exercise the
denial either. Denying it is safe on the evidence — the published 2.3.3 tarball
ships a prebuilt `fsevents.node` and its packed `package.json` has no `install`
or `postinstall`; only the registry packument claims one — but *safe on the
evidence* is not *demonstrated*, and the ADR says so. The durable fix is the unit
test: `test/unit/audit-gate.test.ts` now reads `package-lock.json` and fails if
any package with an install script has no entry in `allowScripts`, or if an entry
matches nothing. Dependabot edits this lockfile most weeks; a hand-maintained
list would have drifted again.

**`esbuild`'s postinstall is not load-bearing**, contrary to the earlier note
here. esbuild ≥0.19 resolves its platform binary through `optionalDependencies`;
`install.js` only validates. Swapping in a genuine wrong-version binary produced
a clear build-time error from the runtime guard at `esbuild/lib/main.js:930` —
`Cannot start service: Host version "0.28.2" does not match binary version "0.21.5"`.
Blocking the script moves the loud failure from install to first build and makes
the message *more* specific, not less.

**The policy lives in `package.json`, not `.npmrc`** — also a correction. npm's
config documentation says the `.npmrc` `allow-scripts` key is for one-off and
global contexts, and that passing `--allow-scripts` during a project-scoped
`npm ci` is an error. The project field is `allowScripts`, which additionally
supports explicit denials, and a denial is silently skipped rather than warned
about forever. Let `npm install-scripts deny <pkg>` write it rather than hand-editing.

☑ **Settled 2026-08-12: enforced in one dedicated CI job, not everywhere.**
`allowScripts` is understood only by **npm 12.0.0+** — bisected; no 11.x release
has it — and npm 12 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, so it
**cannot run on the Node 20.19.0 floor** this project claims and tests in two
matrix legs. No Node release ships npm 12 either; even Node 26.7.0 ships 11.19.0.
So the control goes in a single `supply-chain` job pinned to Node 22 with npm 12
installed explicitly, and the Node floor and the six-leg matrix are left alone.

> **The trap this avoids:** npm 10 accepts `strict-allow-scripts=true` from
> `.npmrc` and reports it as `true` while doing nothing at all. Setting it and
> assuming it applies everywhere would have bought a control that silently does
> not exist on most of the matrix. `engine-strict` with `engines.npm` would make
> that loud, but it would also fail every Node 20 leg, which is why the floor
> question had to be answered first.

☑ **Divergence noted in `docs/dev/building.md`, 2026-08-12.** New section,
*Install scripts, and why your install differs from CI's*: the policy, the fact
that every job but `supply-chain` runs npm 10.x and therefore *does* run those
scripts, the `npm config get strict-allow-scripts` trap, and the
`npm install-scripts ls` / `deny` / `approve` loop. It also records a fragility
worth knowing: `.nvmrc` says `22` unpinned, which is the only reason CI clears
npm 12's `^22.22.2` floor — pinning it to an exact lower 22.x breaks the job on
its `npm install -g` step for reasons unrelated to the change that pinned it.

☐ Add the new `supply-chain` check to branch protection after it first reports —
same `PUT` as above, which re-derives the contexts from what actually ran.

```bash
# 0d-ii-b — scanning (CodeQL + credential shapes)
git checkout main && git pull --ff-only && git checkout -b phase-0d-ii-b-scanning
#   … 🤖 implement 0d-ii-b …
git add -A && git commit -m "ci: add CodeQL and a credential-shape scanner"
git push -u origin phase-0d-ii-b-scanning
gh pr create --base main --head phase-0d-ii-b-scanning --fill
```

☑ **Implemented 2026-08-12.** `.github/workflows/codeql.yml`,
`scripts/check-secrets.mjs`, `test/unit/secret-scan.test.ts` (31 tests),
`check:secrets` in `npm run verify`, and
[ADR-0006](docs/adr/0006-scanning-posture.md). Two defects found by running it
rather than reasoning about it, both recorded in the ADR: an ALL_CAPS environment
*variable name* read as a value, and a planted token printed to the terminal in
full because redaction was opt-in rather than opt-out.

☑ **GitHub's secret scanning does not cover this repository's actual risk.** It
matches *partner patterns* — known token formats from specific vendors. A Viya
bearer token is a generic JWT, and `creds.json` is expected to sit in the working
tree by design. So 0d-ii-b adds a repo-local scanner for credential-shaped
strings alongside the GitHub feature, rather than instead of it.

Four decisions settled 2026-08-12, before implementing:

- **CodeQL as a committed workflow**, `.github/workflows/codeql.yml`, not
  default setup. Default setup is configured in the web UI and is invisible in
  the tree; a committed workflow is reviewable in a pull request and changes to
  it go through the same gate as everything else.
- **The scanner reads the tracked working tree at HEAD**, not history and not
  untracked files. History is immutable — a hit there is a rotation task, not a
  build failure — and untracked files are where `creds.json` is *supposed* to
  live. Scanning what a commit would publish is the question that has an
  actionable answer.
- **It runs inside `npm run verify`**, next to `check:copyright` and
  `check:package`, because it needs no network and no credentials. A check that
  only exists in CI is a check contributors discover by having it fail.
- **False positives are silenced by an inline marker carrying a reason**, not by
  a separate allow-list file. The justification then sits next to the string,
  travels with it if the file moves, and cannot drift out of sync.

☑ **The AI reviewer runbook stays out of the repository.** It was going to be
checked into `docs/dev/`; it is not, by decision on 2026-08-12. It documents the
maintainer's own development setup rather than anything a contributor needs, and
the working copy names an Azure Foundry resource, its endpoint, and deployment
names — org-identifying detail that would now be public and that buys a reader
nothing. It lives in the `viyapy` project folder.

☐ **Enable the repository-side settings** (all free on a public repo, and this
repo went public 2026-08-12): Dependabot alerts, secret scanning, push
protection, and private vulnerability reporting.

```bash
gh api -X PATCH repos/Shai-Alit/sas-py-vscode --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
gh api -X PUT  repos/Shai-Alit/sas-py-vscode/vulnerability-alerts
gh api -X PUT  repos/Shai-Alit/sas-py-vscode/private-vulnerability-reporting
```

☐ Tighten **Settings → Actions → General → Fork pull request workflows** to
require approval for **all outside collaborators**. Deferred from the going-public
audit; no workflow uses `pull_request_target`, so fork PRs cannot currently reach
the Azure secrets, but this closes the door rather than relying on that holding.

☐ Add `analyze` (CodeQL) to branch protection once it has reported — same `PUT`
as the 0d-i one, re-derived from the contexts that actually ran. It is in a
different workflow from the rest, which changes nothing: required checks are
matched on job name.

☑ **Merged 2026-08-12 as #11.** Phase 0 is complete.

### Phase 1 — Authentication

☑ **Settled 2026-08-12, before implementing 1a.** Four decisions, recorded in
[ADR-0007](docs/adr/0007-connection-profile-storage.md) and grounded in a
file-by-file audit of the upstream implementation rather than in preference.

- **Separate storage, plus a one-time read-only import** (open decision #5). Our
  own `pythonOnViya.connectionProfiles`; a command imports their
  `connectionType: "rest"` profiles and copies the endpoint, context and client
  id into ours. We never write their key.
- **The active profile lives in `workspaceState`**, not in the setting. Profiles
  are user-global; *which one is live* is per window, so one window can be on a
  dev deployment and another on production. It also sits next to where 2a keeps
  the compute session id, which is already `workspaceState`.
- **Every profile carries an explicit `version` from day one.** Migrations key
  off it, and a profile whose version is higher than this build understands is
  refused with a message rather than half-read.
- **The client secret goes to SecretStorage and never to settings**, and its
  input box is masked.

> **Why sharing their key was rejected.** Not taste — the other three answers are
> incompatible with it. Their sign-in reads `clientSecret` straight off the
> profile object (`connection/rest/auth.ts:23,64`), so a shared profile must
> carry it in plaintext. Their `migrateLegacyProfiles()` rewrites unrecognised
> profiles on every activation (`components/profile.ts:206-225`). Their
> `activeProfile` is a single global string. And their configuration listener
> runs `commands.executeCommand("SAS.close", true)` on *any* change to that key
> (`node/extension.ts:189-194`), so every profile edit we made would terminate a
> user's running SAS compute session — a bug we would be shipping into somebody
> else's product. The payoff was small in any case: SecretStorage is
> per-extension, so tokens can never be shared and the user signs in twice
> regardless. Sharing would have saved retyping one URL.

```bash
# 1a — connection profiles
git checkout -b phase-1a-connection-profiles
git commit -m "feat(auth): add Viya connection profiles and profile commands"
```

☑ **Implemented 2026-08-12.** `src/profile/` in two halves, because the unit tier
runs outside an extension host and so cannot import `vscode`: `model.ts` and
`import.ts` are pure and carry every rule (endpoint normalisation and refusals,
name validation, per-profile tolerant reading, active-profile resolution, the
secret key), while `store.ts`, `commands.ts` and `statusBar.ts` are a thin shell
over the editor APIs and are covered by `test/integration/profile.test.ts`. That
split is the testing seam the rest of the project inherits — put the decisions on
the side the coverage number can see.

☑ **Coverage ratchet raised for the first time, 2026-08-12** (open decision #6):
55% lines and statements, 63% functions, 86% branches, each set a little under
what the suite measures so a three-OS gate does not fail on rounding. 187 unit
tests, up from 136.

☑ **Two upstream behaviours deliberately not inherited**, both recorded in
ADR-0007. Secrets are keyed on a stable generated `id` rather than on the profile
name (`AuthProvider.ts:134-141`), so renaming a profile does not orphan its
secret. And a missing `connectionType` is inferred from the fields present rather
than defaulted to `rest` (`components/profile.ts:206-225`), so a SAS 9 profile
that predates the field is skipped with a reason instead of being imported as a
Viya one.

☑ **1b split in two, 2026-08-13, along the seam 1a established.** The crypto and
the protocol can be specified by unit tests; the browser handoff and the code
capture can only be exercised in an extension host. Keeping them in one slice
would have put the PKCE audit in the same review as a URI-handler race, and the
audit is the part that needs undivided attention.

☑ **Upstream `auth.ts` audited before porting, 2026-08-13** — all 145 lines of
`client/src/connection/rest/auth.ts`, recorded in
[ADR-0008](docs/adr/0008-auth-core-transport-and-security-deltas.md) and in the
block quote under 1b in the plan. Five deltas, where the plan had previously
recorded one. The one it had not: **upstream never validates `state`**, so its
URI handler accepts an authorization code from any inbound URI. That is the
RFC 6749 §10.12 injection, and it is arguably worse than the `Math.random()`
verifier the plan already knew about. Finding it is the argument for the rule —
"audit, don't transcribe" has to mean reading the whole file, not confirming the
defect you arrived looking for.

☑ **Transport settled, 2026-08-13** (ADR-0008): no `axios`, no runtime
dependency. Node's floor here is 20.19.0 so `globalThis.fetch` exists, msw
already intercepts it, and `"dependencies": {}` is what makes 0d's supply-chain
gates cheap. The core takes a `fetch`-shaped port so 1b-ii has a seam to attach a
proxy dispatcher to.

> **The cost is real and is not fully paid yet.** `fetch` ignores `HTTP_PROXY`,
> and VS Code's proxy support patches `http`/`https` — which global `fetch` never
> touches. Routing it through a proxy needs a custom dispatcher, and Node does
> *not* expose `ProxyAgent` or `setGlobalDispatcher` publicly on the 20.19.0
> floor; those need the `undici` package installed. 1b-ii picks between one
> runtime dependency, a hand-rolled `CONNECT` tunnel, or a narrower supported
> configuration. Recorded now so it arrives as a decision instead of a surprise.

```bash
# ⛔ BARRIER: merge 1a first.
# 1b-i — the auth core, no vscode import
git checkout -b phase-1b-i-pkce-core
git commit -m "feat(auth): add PKCE, token exchange, and client id resolution"
```

☐ **1b-i punch list.** `src/auth/`, and nothing in it imports `vscode`.

- `pkce.ts` — `randomBytes(32).toString("base64url")` for the verifier, 43 chars
  in the unreserved set by construction; `createHash("sha256").digest("base64url")`
  for the challenge; the same CSPRNG for a random `state`. No alphabet table, no
  chained `.replace()`.
- `tokenEndpoint.ts` — `buildAuthorizeUrl`, `exchangeAuthorizationCode`,
  `refreshTokens`. Parse `error` / `error_description` into a typed failure.
  Convert `expires_in` to an absolute `expiresAt` at the moment the response is
  read, so refresh can happen ahead of expiry instead of costing a probe request.
- `clientId.ts` — decision 9. Falls back to the built-in `vscode` client, or
  returns a typed problem code in the `src/profile/problems.ts` style — codes and
  parameters, never English prose, so the shell renders it through `vscode.l10n.t()`
  and the core stays testable.
- The `fetch` port is a structural type defaulting to `globalThis.fetch`.

☐ **Tests that actually pin the thing.** Two matter more than the rest.

- **RFC 7636 Appendix B's own test vector.** Verifier
  `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` must produce challenge
  `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`. A hand-rolled base64url passes a
  round-trip test against itself; it does not pass this.
- **Stub `Math.random()` to a constant with Sinon and assert two successive
  verifiers still differ.** A charset-and-length test would pass on upstream's
  broken implementation. This is the test that fails on it, and so it is the only
  one that actually encodes the CSPRNG requirement.

Then: charset and length bounds, uniqueness across many calls, the OAuth error
envelope, `expiresAt` arithmetic against a faked clock, and the decision-9 matrix
across Viya 3.5 / 4 2022.10 / 4 2022.11+ with `clientId` present and absent.

☑ **Coverage ratchet raised, 2026-08-13.** Measured 63.21 statements, 63.21
lines, 72.04 functions, 90.08 branches; floor set to **62 / 62 / 71 / 89**, about
a point under each. `src/auth` itself measures 98.78 statements with 100%
functions — the global number is far lower because `extension.ts` and the four
`src/profile` shell modules are only reachable from an extension host and score
zero here.

> **This ratchet is about to work against us.** 1b-ii is all shell code — the
> URI handler, `SecretStorage`, the browser handoff — which lands in the
> denominator and scores zero in the unit run, so the global percentage will
> *fall* even though the slice is fully tested by the integration suite. Ratchets
> that have to be lowered are not ratchets. Decide in 1b-ii scoping whether to
> exclude the shell modules from the c8 denominator, run separate thresholds per
> directory, or merge integration coverage in — but decide it before the number
> forces the decision.
>
> **Settled 2026-08-13, before it forced anything:** the first option, in its own
> slice below. ADR-0009.

☑ **Comment the 3.5 path in the code**, not only in the plan: it is built from
SAS's documentation and has never been observed against a live 3.5 deployment,
because there isn't one to observe. Decision 9 was amended on 2026-08-13 to stop
calling that a pending pre-release check — nobody can clear it, and a blocker
nobody can clear is a line people learn to step over.

```bash
# ⛔ BARRIER: merge 1b-i first.
# Interlude — fix the denominator before the slice that would bend it
git checkout -b chore/coverage-denominator
git commit -m "chore(coverage): measure unit-reachable code and check the exclusion"
```

☐ **Coverage-denominator punch list.** Small on purpose, and its own slice on
purpose: a threshold re-baseline has to be measured on a tree where nothing else
moved, or the new number is unattributable.

- `.c8rc.json` — the five `vscode`-importing modules join `exclude`.
- `scripts/check-coverage-scope.mjs` — asserts the rule in **both** directions
  (everything excluded imports `vscode`; everything importing `vscode` is
  excluded), refuses globs, and uses TypeScript's parser so that a comment
  mentioning `vscode` is not read as an import and an erased `import type` does
  not cost a module its floor. Joins `npm run verify`.
- Its unit test, including one case that runs the check against this repository —
  so drift fails by file name in the tier that runs on three operating systems,
  not only in the gate.
- ADR-0009, `docs/dev/testing.md`, `docs/dev/ci.md`, `docs/dev/building.md`,
  `CHANGELOG.md`.

☑ **Ratchet re-baselined, 2026-08-13.** Measured 79.30 statements, 91.87
branches, 77.77 functions, 79.30 lines; floor set to **77 / 90 / 76 / 77**. The
run added no tests and touched no source file — the sixteen points against 1b-i's
63.21 are the measurement changing, which is the size of the distortion the old
denominator was carrying.

> **The next argument about this number will be about `scripts/`.** It measures
> 64.76% and is now the only drag, against `src/auth` at 99.65 and `src/profile`
> at 98.30. Most of what is uncovered is each script's `main()`, behind the
> `process.argv[1]` guard that lets the unit tier import a script without running
> it — so what is untested is precisely the part that decides whether a gate
> exits non-zero. Worth its own slice; do not let it be bolted onto a feature.

```bash
# ⛔ BARRIER: merge the denominator slice first.
# 1b-ii — the VS Code shell
git checkout -b phase-1b-ii-auth-shell
git commit -m "feat(auth): add browser sign-in, dual code capture, and proxy support"
```

☑ **An integration test per shell module — this one is now load-bearing.**
ADR-0009 took the shell out of the coverage denominator, so no threshold will
notice a missing test any more. The guarantee is this line and a reviewer's
attention, which is weaker than a number and is why it is written down here.
Done 2026-08-13: five suites under `test/integration/auth/`, 36 tests, one per
shell module. Two things the tier caught that no unit test could have. First, a
`vscode.LogOutputChannel` is identified by its **name**: dispose one and create
another by the same name and the host hands back the cached, already-disposed
logger, after which every write throws `Channel has been closed` — a per-test
create/dispose cycle in the helper killed seven browser-flow tests and reported
the failures against `browserFlow.ts`. Channels are now created once per name and
outlive the run, which is what an extension does anyway. Second, `SecretStorage`
is unreachable from a test — it arrives only through `ExtensionContext`, which
only `activate` is given — so the store suites run against an in-memory double and
the real keychain is reached the one way a test can, by running
`pythonOnViya.signOut` end to end. The trade-off is written up in
`test/helpers/auth-host.ts` rather than left implicit.

☑ **1b-ii punch list.** Every item below done 2026-08-13.

- ☑ **Two commands, not in the original list.** `pythonOnViya.signIn` and
  `pythonOnViya.signOut`, on the active profile rather than behind a picker —
  the active profile is already in the status bar, and a second place to choose
  it invites the two to disagree. Sign-in prompts for the client secret when the
  profile names a `clientId` and none is stored, which is the promise the import
  command already makes ("you will be asked for the client secret the first time
  you connect") coming due.
- ☑ **`env.asExternalUri` on the callback URI _before_ it goes into the authorize
  URL**, then `env.openExternal`. `asExternalUri` is what makes this work in
  Codespaces and remote/SSH windows; skipping it is the classic "works locally,
  fails remote" auth bug. Done 2026-08-13 in `browserFlow.ts`. A host that cannot
  produce an external URI degrades to a paste-only sign-in rather than failing —
  `beginSignIn` omits `redirect_uri` entirely and the deployment falls back to
  whatever it has registered.
- ☑ **Wire `stateMatches()`.** This is the whole reason 1b-i shipped a state
  primitive with no caller. The URI handler compares the inbound `state` against
  the one generated for _this_ attempt and drops any callback that does not
  match. **1b-ii cannot merge without it** — the RFC 6749 §10.12 injection is
  closed at this point and nowhere else. Done 2026-08-13, in `readCallback`
  rather than in the handler itself: dispatch to the right attempt *is* the state
  check, so the handler offers each callback to every outstanding attempt and the
  one that issued the `state` recognises it. The check runs before anything else
  is read out of the query, and on the `error` arm as well as the success arm.
- ☑ **The paste-box arm carries no `state` and cannot be protected the same way.**
  Say so in the code. That is an argument for narrowing the paste box later, not
  for skipping the check on the arm where it works. Said, at length, in the
  `browserFlow.ts` module doc. A pasted *URL* is routed through `readCallback` and
  so is state-checked; only a bare code is not.
- ☑ **`registerUriHandler`** on activation, disposed on deactivate. One handler for
  the extension, dispatching to whichever attempt is outstanding. Done 2026-08-13:
  `registerAuthUriHandler` in `extension.ts`, with the disposable on
  `context.subscriptions`. Upstream registers inside its sign-in function, so a
  second sign-in registers a second handler.
- ☑ **The dual-capture race.** URI handler versus `showInputBox`. Whichever lands
  first wins; the loser is cancelled rather than left dangling, and the input box
  closes on a successful callback. Done 2026-08-13. The subtlety worth keeping in
  mind: `showInputBox` resolves `undefined` both when the user dismisses it *and*
  when its cancellation token fires, and the second is the case where sign-in
  succeeded — so the paste arm asks `token.isCancellationRequested` before
  interpreting `undefined` as a cancellation. That started as a shared `settled`
  flag; type-aware lint was right to reject it, because the flag was a second copy
  of something the cancellation token already knew. A paste that cannot be used
  re-prompts, bounded at five attempts so a stubbed box cannot spin.
- ☑ **`SecretStorage`** keyed on the profile's generated `id`, not its name
  (ADR-0007's delta from upstream). Persist the refresh token; the access token
  can be re-derived and need not outlive the session. Done 2026-08-13 in
  `sessionStore.ts`, under `pythonOnViya.session.<id>` — distinct from the client
  secret at `pythonOnViya.profile.<id>`, so signing out destroys the session
  without destroying configuration the user typed. An entry that will not parse is
  deleted rather than logged about forever.
- ☑ **`vscode.l10n.t()` renderer for `AuthProblem`** — the codes-not-prose seam from
  1b-i. Exhaustive switch, explicit `string` return, no `default`, so a new code
  is a compile error rather than a silently untranslated message. Done 2026-08-13
  as `messages.ts`. Named differently from its profile counterpart because
  `problems.ts` in `src/auth/` was already the codes; renaming it would have
  churned five importers to buy symmetry.
- ☑ **Swap the default transport to `https.request`** and rename `FetchLike`.
  Done 2026-08-13: `src/auth/transport.ts` exports `nodeHttpTransport`, and the
  port is now `HttpTransport`. Superseded plan: this line previously read "the
  undici `ProxyAgent` dispatcher". Research on 2026-08-13 found a fourth option
  ADR-0008 had not considered, and it is better than all three it did — requests
  through the `http`/`https` modules reach enterprise proxies **and internal
  certificate authorities**, at zero dependency cost, while `fetch` reaches
  neither. Stated as the observable consequence on purpose: upstream ships no
  proxy or TLS code at all and works in those environments, which is the evidence;
  *which* host setting arranges it was not verified and is not asserted anywhere.
  The certificate half is the part that matters — internal CAs are routine in
  enterprise Viya and fail at sign-in, a far more common configuration than a
  corporate proxy. ADR-0008 amended on this branch; unit tests run against a real
  loopback server rather than msw, which would otherwise stand in for the code
  under test.

**Test seam.** Everything except the transport swap needs an extension host, so
it lands in `test/integration/`. Keep the pure decisions — which arm won, whether
a state matched, what to persist — in functions the unit tier can still reach.
Same split 1a established, and now the only thing holding the shell's line.

☑ **Ratchet raised, 2026-08-13.** Measured 81.98 statements, 92.69 branches,
80.86 functions, 81.98 lines; floor set to **79 / 91 / 78 / 79**. The measurement
did not move during this slice's test work, and that is the expected result rather
than a disappointment: ADR-0009 excludes every module the new integration suites
exercise, so 36 tests that hold the shell's line are invisible to this number by
construction. What raised it was 1b-ii's *core* — `clientId.ts`, `pkce.ts`,
`signIn.ts` and `tokenEndpoint.ts` all at 100, `transport.ts` at 97.82.

☑ **Review response, 2026-08-13.** Two findings, one of each verdict, and both
were checked against the code rather than acted on.

The 🔴 blocking one — "the `post()` call passes no `AbortSignal`, so the request
can neither be cancelled nor time out" — is a false positive. `tokenEndpoint.ts`
passes `AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)`, and
`transport.ts` honours it, with tests for an already-aborted signal and for one
that fires mid-request against a real loopback server. The reviewer was
describing the `fetch` code this slice replaced. It did expose a real gap
though: nothing pinned that the token endpoint *supplies* a signal, only that the
transport respects one, so a refactor that dropped the line would have left every
test green and shipped a sign-in that hangs for as long as a proxy will hold the
socket. That is now two tests in `auth-token-endpoint.test.ts`.

The 🟠 major one — a public client is re-prompted for a secret at every sign-in,
because an empty answer is discarded — is correct, and the fix it suggested is
not. "Store the empty string" fails on any machine without an OS keyring: VS Code
guards its read on the *stored* value being falsy, and the in-memory fallback
backend encrypts with the identity function, so `""` goes in and `undefined`
comes out. Verified in the shipped `workbench.desktop.main.js` for 1.133.0, which
`.vscode-test/` already had on disk. So the claim is configuration in
`globalState`, the secret store keeps only secrets, and `secret()` is tri-state.
`ProfileStore`'s constructor now asks for the three context members it uses
rather than the whole `ExtensionContext`, which is what makes any of this
testable without a cast — `test/integration/profile/secret-storage.test.ts`.

**Split into 1c-i and 1c-ii, 2026-08-13.** The two halves share a slice number
and nothing else. One is an editor integration whose risk is state management;
the other is a TLS change whose risk is that it quietly widens what the extension
will trust. Reviewing them together means the certificate half arrives as the
small half of a big diff, which is how that kind of change gets waved through.

**Two of the four things the plan listed under 1c already shipped in 1b-ii.**
Per-profile namespacing in `SecretStorage` is `sessionStore.ts`, keyed on the
generated profile id under `pythonOnViya.session.<id>`, and the refresh-token-only
persistence policy is `toStoredSession`. 1c-i builds the provider **on top of**
those rather than re-deciding them; a punch list that re-lists finished work is
how a slice grows a phantom third of its size.

```bash
# ⛔ BARRIER: merge 1b-ii first.
# 1c-i — the AuthenticationProvider
git checkout -b phase-1c-i-auth-provider
git commit -m "feat(auth): register an AuthenticationProvider and resolve the Viya identity"
```

☐ **Probed first, 2026-08-13, before any of this was written.** Findings 6–9 in
`PROBE-FINDINGS.md`, against the live Viya 4. Three of them change what gets
built, so probing after scoping would have meant scoping twice.

☐ **1c-i punch list.**

- ☑ **`src/auth/identity.ts` — pure, and it stays in the coverage denominator.**
  The response parse, the label fallback chain, and `accountId(endpoint, userId)`.
  No `vscode` import, so ADR-0009 keeps it measured, and the account model gets
  specified by unit tests against a scrubbed fixture rather than by whatever the
  provider happens to do. ~~`id` is required and `name` is required~~; everything
  else is optional, because finding 8 only established `title` and `state` on one
  deployment.
  **Corrected while implementing, 2026-08-13: only `id` is required.** The two
  rules cannot both hold. Decision 10 specifies a label fallback of `name` → login
  → `id`, and a parser that rejects a user carrying no `name` makes both fallback
  arms unreachable — the chain would be dead code and the tests covering it would
  be testing nothing. The one deployment we could probe is SCIM-backed and
  populated `name`; the ones we could not are LDAP-backed and Viya 3.5, which are
  exactly where a missing display name shows up. Requiring a cosmetic field there
  turns "no display name" into "cannot sign in". Recorded in the module doc.
- ☑ **Ask for `application/vnd.sas.identity.user.summary+json` explicitly, and
  say why in the code.** Finding 7: the full representation returned a street
  address, a postal code, a work email and two phone numbers for a real person,
  and upstream sends no `Accept` header at all, so it pulls every one of those
  into the extension host and keeps two fields. The summary type is the same URL
  and the same 200. This is one header and it is the difference between that data
  being in our process and not.
- ☑ **A 406 on the summary type falls back to the full representation, dropping
  the PII fields as it parses.** Not defensive padding: finding 6 showed 406 is
  what a media type this service does not serve looks like, and no Viya 3.5
  deployment exists to check the summary type against. The fallback is what lets
  3.5 be unverified rather than unsupported.
- ☑ **Widen `TransportResponse` to expose response headers.** Today it carries
  `ok`, `status` and `text()`, and finding 9 makes that insufficient: a dead
  token is a **401
  with a zero-byte body**, and the whole diagnosis lives in `WWW-Authenticate`.
  Any error path that builds its message from the body renders an empty string
  for the most common recoverable failure there is. Parse RFC 6750's `error` and
  `error_description` into a new `AuthProblem` code, and distinguish
  `error="invalid_token"` (sign in again) from a bare `WWW-Authenticate: Bearer`
  (nothing was sent). `TransportRequest.body` also needs to be optional or this
  slice sends `""` on a `GET`; decide which in the PR rather than by accident.
  **Decided 2026-08-13: optional.** A `GET` now carries no body and no
  `content-length`, rather than an empty string and a `content-length: 0` that
  says the request had a body which happened to be empty.
- ☑ **`src/auth/authProvider.ts` — the shell.** Register the provider, contribute
  `authentication` in `package.json` ~~with `supportsMultipleAccounts`~~, and hold
  no logic that `identity.ts` or `signIn.ts` could hold instead.
  **Corrected while implementing, 2026-08-13: `supportsMultipleAccounts` is not a
  manifest field.** The `authentication` contribution takes an `id` and a `label`
  and nothing else — upstream's manifest carries exactly those two, and
  `@types/vscode` puts `supportsMultipleAccounts` on the options argument of
  `vscode.authentication.registerAuthenticationProvider`. It is passed there, in
  `registerAuthProvider`. The distinction matters beyond pedantry: had it been
  written into the manifest it would have been silently ignored, and VS Code would
  have treated a second `createSession` as replacing the first — the exact
  single-session behaviour this slice exists to avoid, failing only on the
  two-deployment path a single review pass is least likely to walk.
- ☑ **`createSession` and `removeSession` call the same code the sign-in and
  sign-out commands already do.** Two sign-in implementations is how the Accounts
  menu and the command palette drift into disagreeing about who is signed in.
- ☑ **`getSessions` does not refresh.** Upstream refreshes on every call, and the
  Accounts menu polls, so opening a menu becomes a network round trip and a
  transient failure becomes a silent sign-out. Refresh against the `expiresAt`
  1b-i already computes; a 401 from a real request stays the fallback.
- ☑ **`removeSession` rejects an id it does not recognise.** Upstream falls back
  to the active profile, which turns a caller's bug into signing the user out of
  something they did not name.
- ☑ **`onDidChangeSessions` fires on real transitions only.** Put the comparison
  in a pure `diffSessions(before, after)` so "did anything actually change" is a
  unit test and not an observation about event volume.
- ☑ **`pythonOnViya.authorized` context key**, set through `setContext`, for the
  `when` clauses Phase 2 onward will gate on.
- ☑ **The access token stays in memory.** `sessionStore.ts` persists the refresh
  token and only that; the provider must not widen it. Writing a credential to
  disk that will be dead within the hour buys nothing.
- ☑ **Raise the ratchet** from a measured run. `identity.ts` is unit-reachable, so
  unlike 1b-ii this slice should actually move the number.
  **Measured 2026-08-14: 84.28 statements / 92.33 branches / 83.94 functions /
  84.28 lines**, up from 82.07 / 92.75 / 81.03 at 1b-ii — it did move, and it
  moved most on functions, which is what a slice of new pure modules should do.
  Thresholds set to **82 / 82 / 82 / 91** (lines / statements / functions /
  branches). Branches stays at 91: measured 92.33 leaves 1.33 points of slack,
  and tightening to 92 would leave 0.33 on a three-OS gate.

**Two more folded in on 2026-08-14, after the first sign-in against a real
deployment.** Neither is 1c-i's subject and both block anyone using the branch,
which is the test for folding rather than filing.

1. **The built-in `vscode` client gets no `redirect_uri`.** The sign-in failed
   after authentication with *"Invalid redirect
   `vscode://…/auth-callback%3FwindowId=2` did not match one of the registered
   values"*. Three browser probes settled why, and it is not the extension id:
   sending upstream's own `vscode://sas.sas-lsp` was rejected too, and omitting
   `redirect_uri` produced a consent page announcing
   `urn:ietf:wg:oauth:2.0:oob`. The built-in client has **no** custom-scheme
   redirect registered. So `beginSignIn` now sends the shell's callback URI only
   when the profile named the client, and the decision lives there because both
   OAuth legs read `pending.redirectUri` and RFC 6749 §4.1.3 requires them to
   agree. Two consequences worth keeping: the paste box is the **only** route on
   the built-in client rather than the fallback, and upstream's trick of
   smuggling the callback URL through `state` buys nothing — tested in both
   encodings, SASLogon displayed the code both times. The `state` nonce check
   1c-i wired is therefore safe: on the oob path there is no callback to check,
   and on a registered-redirect path the callback carries the nonce normally.
   The `%3F` was real too and separately fixed: `callbackUri()` now concatenates
   the parsed `Uri` components instead of trusting `toString(true)`.
2. **The PKCE verifier reached the log.** SASLogon echoes the `code_verifier` it
   received back inside `error_description`, and `describeAuthProblem` passes
   that field through verbatim — by design, it is the most useful diagnostic in
   the flow. `redactSecrets` in `problems.ts` scrubs the values this process
   knows are secret out of the server's text. Dropping `error_description`
   instead would have traded one leak for permanent blindness. It was applied in
   `finishSignIn` first and moved into `tokenEndpoint.post` under review (below),
   because one call site per grant is one call site too many.

**Sign-in works end to end against a real Viya 4, 2026-08-14.** The authorize
leg without a `redirect_uri`, the consent page, the pasted code, the token
exchange, the identity read and the session write, in one pass; the output
channel says `Signed in to <endpoint>` and names no user, which is deliberate —
a display name in a log is a real person in an issue report. That closes the
first line of the manual check at the end of 1c-ii. The second line — reload the
window and confirm the account comes back — was run the same day and **failed**,
which found the activation defect recorded below; **re-run after the fix, it
passes**: the window comes up already signed in, and the tell is that the
Accounts menu no longer offers "Sign in with SAS Viya" at all, because there is
nothing left to sign in to. The third — a second profile appearing as a second,
independent account — **also passes**, which is decision 10 confirmed against a
live deployment rather than argued from the code: two rows, two display names,
two refresh tokens under their own `SecretStorage` keys, and signing out of one
leaving the other alone. That is the single-session model upstream carries,
tested and not repeated.

One thing the check surfaced, and it is a real defect rather than a surprise:
**signing in always acts on the active profile**, whichever account row was
clicked, because `createSession` reads `profiles.active()` and VS Code hands the
provider no indication of which account the user meant. Switching profiles first
is a workaround, not the behaviour. Tracked as the "Accounts menu acts on any
profile" correction — the docs claim is wrong in the same place the code is.

**Three source changes the punch list did not ask for, all found by writing the
tests, 2026-08-13.** Recorded here because "the tests caught it" is worth more as
a record than as a memory.

1. `challenge.ts` refused to treat `Bearer <junk>` as a Bearer challenge — a
   guard required the first token after the scheme to contain an `=`, so a
   malformed challenge parsed as *no challenge at all*. That maps to
   `not-authenticated`, which tells the user nothing was sent when something was
   and the server garbled its reply. The guard is gone; a parameter without an
   `=` is now a no-op rather than a verdict.
2. `identity.ts` `root()` did not trim. Two spellings of one endpoint — a stray
   space in a hand-edited setting, a pasted trailing slash — produced two account
   ids, and the same deployment would have appeared twice in the Accounts menu.
3. `authProvider.ts` refreshed with `clientId: profile.clientId ?? ""`, which
   renews nothing on any deployment using the built-in `vscode` client — that is
   every Viya 4 from 2022.11 on, so very nearly all of them. It now resolves the
   same `BUILT_IN_CLIENT_ID` default the sign-in path does. This one would not
   have shown up until a token expired, an hour into a working session.

**Six review findings answered on 2026-08-14**, from CodeQL and the two bot
reviewers on `phase-1c-i-auth-provider`. All six were accepted; none needed an
argument, which is worth noting on its own.

1. **CodeQL, high: remote property injection** in `transport.ts`. Response
   headers were accumulated into an object literal, so a header named
   `__proto__` reached its prototype. They are collected into a `Map` and
   handed to `Object.fromEntries` now, and the collection is an exported pure
   function so it is unit-testable rather than reachable only through a socket.
2. **A transport failure while reading the identity said
   `token-endpoint-unreachable`.** It names the wrong host and points the reader
   at the wrong half of the deployment; it is an `identity-unavailable` carrying
   the path and the reason now.
3. **`createSession` served the cached identity.** The cache exists so renewing a
   token costs no round trip, but a fresh sign-in is precisely when the user may
   have picked a different account, and the new session would have worn the old
   user's name. `establish` now takes an `IdentitySource`, so the seam is in the
   type rather than in a comment. The reviewer's other half was right too — no
   test covered "sign in again while a live session is held", because
   `createSession` would have opened a real browser. `AuthProviderDeps` gained
   the three browser ports, and there are now two tests: one that the second
   sign-in re-asks, one that a renewal still does not.
4. **The refresh failure logged an unredacted problem.** Rather than add a second
   `redactSecrets` call beside the first, the scrub moved into the token
   endpoint's `post`, which is the one place both grants pass through. Four unit
   tests pin the behaviour, including the two that matter most: a refresh token
   echoed back is scrubbed, and `redirect_uri` is *not* — that message is what
   diagnosed the `oob` problem, and an over-eager scrub would have hidden it.
   Writing those tests turned up a real defect in the scrub itself:
   `redactText` had no length floor, so the one-character `code` and
   `codeVerifier` the existing failure tests used matched everywhere and
   rendered the message as `In[redacted]alid redire[redacted]t …`. Values under
   `MIN_REDACTABLE_LENGTH` (8) are skipped now — substitution can only hide a
   distinctive value, and a single character is recoverable from context anyway
   — and the placeholders in those tests are realistic lengths, so they exercise
   the substitution rather than the skip.
5. **`AUTH_PROVIDER_LABEL` was a bare literal.** Now `authProviderLabel()`,
   resolved at registration through `vscode.l10n.t()`. `l10n/bundle.l10n.json` is
   generated at `vscode:prepublish`, so nothing had to be hand-edited.
6. **The live claims were not in `PROBE-FINDINGS.md`.** Fair: they were in a
   commit message and a plan paragraph. Findings 10-12 record them properly, with
   a methodology note admitting this evidence came from driving a browser rather
   than from `curl`, because the authorize leg needs a password typed by a human.

**Three more, from the second review round on 2026-08-14.** Two were bot
findings on the same branch; the first came out of the manual check above and is
the one worth reading twice.

1. **Nothing brought the session back after a reload**, and the cause was not in
   `auth/` at all. `activationEvents` was `[]` — correct as far as it went, since
   a contributed command activates its extension implicitly from VS Code 1.74 —
   but a reloaded window runs no command. The extension never woke, the provider
   was never registered, VS Code had nobody to ask, and the Accounts menu came
   back empty over a perfectly good refresh token. Sign-in had only ever worked
   because running the command was itself the activation. `onStartupFinished`
   now, which fires after the window is up; `onLanguage:python` remains out of
   the question, for the reason `docs/dev/building.md` gives. The comment in
   `extension.ts` and the paragraph in `building.md` both argued for the empty
   list, confidently and at length, and both were wrong in the same place — a
   reminder that a well-written justification is not evidence.
2. **`establish` opened a dialog when the identity read failed.** The reviewer
   asked for the modal to be dropped on the renewal path; it is dropped on both,
   which is stronger and is what the code already implied. `createSession`
   rejects when `establish` returns `undefined`, and VS Code shows that rejection
   — so the dialog was a *duplicate* when the user asked and an *interruption*
   when they did not. Log only now, `error` on `"new-sign-in"` and `warn` on
   `"renewed-token"`, matching the refresh branch directly above it. The
   integration test that pins this asserts the rejection, not the absence of the
   dialog: the message the user gets is now the only one there is, so it is the
   thing that must not regress.
3. **Workspace trust was documented and unenforced.** ADR-0002 has claimed since
   0b that connecting requires a trusted folder; nothing checked. Enforced now at
   the token boundary — all three provider entry points — with the two commands
   carrying `isWorkspaceTrusted` as a courtesy on top. Two details worth keeping:
   `removeSession` is gated as well, though it only deletes, so the refusal names
   the folder instead of blaming the profile id; and trust granted mid-window is
   picked up through `onDidGrantWorkspaceTrust`, because this extension declares
   `supported: "limited"` and therefore keeps running across that transition
   rather than being restarted into a trusted host. The integration host cannot
   be made untrusted — it opens an empty window, and empty windows are trusted —
   so `AuthProviderDeps.isTrusted` exists purely so the closed branch is
   executed by something. ADR-0002 itself warned that "integration tests must
   cover the untrusted path, or the restriction will rot"; it rotted before the
   ink dried.

**Two more, from the third review round on 2026-08-14**, both bot findings on the
pushed branch, both accepted.

1. **The sign-out command swallowed every failure**, reporting all of them as
   "You are not signed in". Worse than the finding said: the case the `catch` was
   written for — the provider not recognising the id — is nearly unreachable from
   that command, because `profiles.active()` supplies the id and `profileById`
   looks it up in the same store, so essentially everything that arm ever caught
   was a real failure. Once trust enforcement landed the day before, the message
   it was most likely to hide became the trust refusal: the one error whose whole
   value is the command name it tells you to run. `removeSession` now throws a
   `NoSuchSessionError`, and the command discriminates on the type rather than on
   the message — the message is localised, so matching it would have worked in
   English and swallowed the refusal in every other display language. The
   integration tests assert the type on the unknown-id path *and* assert that the
   trust refusal is not that type, because a discriminator only earns its keep if
   both sides of it are pinned. The command's own reporting arm has no automated
   cover: it lives in a `vscode`-importing module, and there is no way to read
   back which dialog was shown.
2. **`redactSecrets` was the one switch in `problems.ts` with a `default`.**
   `describeAuthProblem` and `messages.ts` name every variant so that adding one
   is a compile error, and this is the function where that guarantee actually
   protects something: a missing case in a renderer ships an untranslated
   sentence, and a missing case here ships a secret. A `default` returning the
   problem untouched is exactly the shape that lets a future variant quoting a
   server-supplied string compile cleanly and never be scrubbed, and nothing
   reports it, because "not redacted" is indistinguishable from "nothing to
   redact". All eight variants are named now. No behaviour changed; the existing
   `every`-variant test already covered the arm.

**The identity fixture is in `test/fixtures/harness/`, not `viya4/`.** Findings 7
and 8 deliberately recorded field *shapes* rather than values, because the values
were a real person's address and phone numbers, and `creds.json` is no longer
staged in the project folder, so there is no raw body to scrub and no way to
capture one right now. It is hand-written under the escape hatch
`test/fixtures/README.md` provides and says so in the file. Worth replacing with
a real capture when `creds.json` is next staged: one read-only `GET` with the
summary `Accept` header, and — per finding 7 — a correctly captured *summary*
response needs no scrubbing at all, which is the strongest argument for that
header there is.

**Test seam.** `identity.ts` and `diffSessions` are unit tier and are the
specification. The provider registration, the context key, and the session change
event need an extension host, so they land in `test/integration/auth/`. The
identity fetch is tested against `test/helpers/mock-viya.ts` with a fixture
scrubbed per `test/fixtures/README.md` — which requires the `PROBE-FINDINGS.md`
entry that finding 6–9 now provides.

```bash
# ⛔ BARRIER: merge 1c-i first.
# 1c-ii — private CAs and the TLS agent
git checkout -b phase-1c-ii-private-ca
git commit -m "feat(auth): trust user-supplied CA certificates on a dedicated agent"
```

☐ **1c-ii punch list.**

- ☐ **A `pythonOnViya.userProvidedCertificates` setting**, a list of paths, with
  the reference docs regenerated.
- ☐ **A dedicated `https.Agent`**, built from `tls.rootCertificates` plus the
  user's, passed as the `agent` option `transport.ts` deliberately left free.
  **Do not touch `https.globalAgent`.** Upstream's `CAHelper.ts` sets
  `https.globalAgent.options.ca`, which is process-global state in a host shared
  with every other installed extension: it changes what *they* trust, silently,
  and no test of ours could ever catch it.
- ☐ **An unreadable or malformed certificate is reported, not swallowed.**
  Upstream `console.log`s inside the `catch` around `fs.readFileSync`, which
  fails two §5 gates on arrival. Name the path, through the log channel, and
  carry on with the certificates that did load.
- ☐ **A test that proves the agent is scoped.** Build the agent, then assert
  `https.globalAgent.options.ca` is untouched. That assertion is the entire point
  of the slice and is the one a future refactor would otherwise quietly break.

☐ **After 1c**, verify manually against your Viya: sign in, reload the window,
confirm the session persists and the Accounts menu shows your identity. Then add
a second profile pointing at a different deployment and confirm they appear as
**two** accounts and that signing out of one leaves the other signed in — that is
decision 10, and it is the behaviour a single review pass is most likely to miss.

### Phase 2 — Compute session and backend seam

> **1c-ii is deferred, not done, and it does not block Phase 2.** Sign-in works
> end to end against a real deployment today because Node already trusts that
> chain. A deployment behind a private CA fails at TLS, which is a robustness gap
> rather than a demo blocker. It stays on the list; Phase 2 starts without it.

> **The client is hand-written — ADR-0010.** The pre-agreed "2a-i vendors the
> generated client" split is gone, and so is the `check:coverage-scope` collision
> ADR-0009 warned about, because there is no generated client to exclude. The
> split below is the same pure-core / VS-Code-shell seam 1b and 1c used.
>
> Everything in 2a-i is grounded in **`PROBE-FINDINGS.md` findings 13–20**
> (2026-08-14, live Viya 4), plus findings 6 and 9 from the identity probe. Read
> those before starting; every item below cites one, and several contradict what
> upstream's code would lead you to write.
>
> **Corrected 2026-08-14, mid-slice.** The items below originally cited findings
> 11–16, which is what the probe notes were numbered as while 2a was being
> scoped. Those numbers were never written into `PROBE-FINDINGS.md`, whose 11 and
> 12 are the OAuth findings from the day before — so the citations already
> shipped in `links.ts`, `client.ts` and `problems.ts` pointed at unrelated text.
> The Compute findings are now written up as **13–20** and every citation in the
> slice has been repointed. One of the old notes did not survive the write-up:
> see the `+json` item.

```bash
# 2a-i — the Compute core, no vscode import
git checkout -b phase-2a-i-compute-core
git commit -m "feat(compute): add the link layer, context resolution, and session lifecycle"
```

☐ **2a-i punch list.**

- ☑ **Done 2026-08-14. `src/compute/links.ts` — link lookup, href resolution,
  and the media-type rule.** Five small functions and the `Link` type. Store the
  deployment **root** only; resolve each `href` against it. **Never build a base
  path that contains `/compute`** — that is the entire cause of upstream's
  `link.href.replace("/compute", "")` wart (finding 13), and keeping the root
  separate means no href is ever rewritten, so the wart cannot exist to be fixed.
  Hrefs may carry a query string with percent-encoding, so resolution must not
  re-encode what the server sent.

  Two corrections to the wording above, found while writing it. The base is the
  **whole normalised endpoint, not a bare origin**: `normaliseEndpoint` in
  `src\profile\model.ts` returns `` `${url.origin}${path}` ``, so a deployment
  published under a path prefix is legal and `new URL(endpoint).origin` would
  silently drop it. And `resolveHref` **concatenates rather than resolving**, and
  rejects absolute and protocol-relative hrefs with an exported
  `ForeignLinkError`. `new URL(href, base)` fails twice over: it would resolve an
  absolute href to whatever host that href names — sending the user's bearer
  token there, the disclosure `transport.ts` refuses redirects to avoid — and its
  query percent-encode set includes `'`, so it rewrites exactly the hrefs finding
  13 says must go back unchanged.
- ☑ **Done 2026-08-14. The `+json` rule is a total function over
  `string | null | undefined`**
  (finding 14). Link types arrive bare — `application/vnd.sas.compute.job.request`
  — and the service wants `+json` appended. `text/plain` links (`state`,
  `getOption`) must be left alone, and a link with no media type — every `delete`
  link — **omits the key**, so a signature of `string` throws on `DELETE`, during
  teardown, which is where a second failure is worst. Table-driven unit test
  covering all three shapes plus `text/plain`. **No `media-typer` dependency**;
  the rule is three lines.

  **The `null` half of that signature did not survive the write-up.** This item
  originally also claimed the same delete link arrives as `"type": null` on a
  context summary. Re-checked with `has("type")` while writing finding 14: that
  was a `jq` artifact — projecting `{rel, type}` prints `null` for a key that is
  merely absent — and **no explicitly-null `type` occurs** on this deployment.
  `Link.type` still admits `null`, and the test still pins it, but as deliberate
  breadth; both now say so rather than citing an observation that was not made.
- ☑ **Done 2026-08-14. One `findLink`, not two.** Upstream has `getLink(links, rel)` in
  `rest/common.ts` and a different `getLink(links, method, relationship)` in
  `rest/util.ts`. Ours is one function with one signature.
- ☑ **Done 2026-08-14. `src/compute/problems.ts` — the Viya error envelope as a
  problem union.** Same shape as `src/auth/problems.ts` and
  `src/profile/problems.ts`: no `vscode` import, English fragments for the log,
  an exhaustive `switch` with **no `default`**, and the user-facing wording
  deferred to 2a-ii. The envelope is
  `{message, errorCode, httpStatusCode, details[]}` where `details` mixes a human
  sentence with `path:` and `correlator:` entries (finding 17). **Surface the
  correlator** — it is what a support ticket needs — and do not paste the whole
  array into a dialog.

  Three notes from writing it. `readViyaError` is **total** — status plus raw
  body in, a `ViyaError` out, never a throw — because it runs on the failure path
  and often on the failure path of a teardown, where a parser that throws
  replaces a diagnosable problem with an opaque one. The `path:` entry is
  **dropped rather than quoted**: it is the one field that reflects our own
  request back at us, and not repeating request-derived text is the cheapest way
  to keep the file free of anything that could become a credential. And there is
  deliberately **no `redactSecrets` twin** — `auth/problems.ts` needs one only
  because SASLogon echoes the PKCE verifier inside `error_description`, and the
  Compute service reflects no request header. The module doc says so, so that its
  absence reads as a decision rather than an omission.
- ☑ **Done 2026-08-14. Do not re-implement 401 handling.** 1c already parses RFC
  6750's `error`/`error_description` out of `WWW-Authenticate` and distinguishes
  an expired token from a request that carried no credentials (finding 9). Reuse
  it rather than writing a second, subtly different version — two answers to "is
  this token dead" is how a refresh loop starts. Done by having the
  `unauthorized` variant **carry an `AuthProblem`** rather than a status, so
  `describeComputeProblem` delegates to `describeAuthProblem` and there is no
  second copy that can drift.
- ☑ **`src/compute/client.ts` — the request helper on 1b's transport.**
  **Done 2026-08-14.** Derive `Content-Type` from the link's `type` and `Accept`
  from its `responseType` (falling back to `type` on a GET), attach `If-Match`
  where an ETag is held, and carry `If-None-Match` on conditional reads. ETags
  may be **weak** (`W/"…"`) and must be echoed verbatim. Note that `DELETE`
  returned **204 without `If-Match`** (finding 18), so the header upstream always
  attaches is not required — send it only when it is held.

  Four things settled while writing it. **`Accept` is omitted, not guessed**,
  when the link declares neither media type: finding 6 says a type the
  deployment does not serve is a `406`, which fails the request outright,
  whereas no header at all yields the server's default representation — which is
  the one the link intended. The `type` fallback is **GET-only**, because on a
  `POST` that field describes the body being sent and asking for it back is how
  a create call demands the `…request+json` it just uploaded.

  **`304` is a success.** It carries `notModified: true` and an unset `body`, so
  the state long poll (finding 19) reads "still what you had" rather than
  reporting a problem every five seconds.

  **The token arrives as a function**, not a string. A compute session outlives
  the access token that created it, and a client holding a string keeps sending a
  dead one after a refresh has already fixed it. That is also what replaces
  upstream's process-global mutable `Configuration` singleton — everything the
  client needs is on the config object it was built with, so two profiles in one
  window cannot overwrite each other's base URL.

  **A `404` is left unclassified**, as `compute-rejected`. Whether it means "this
  session is gone" or "no context by that name" depends on what was asked for,
  and only the caller knows; `session.ts` and `contexts.ts` convert it. The
  client classifies only what it can read without that context: unreachable,
  401, 403, and a JSON body that will not parse.

  The 401 arm calls `challengeProblem`, which this item extracted from
  `src/auth/identity.ts` into `src/auth/challenge.ts` — the second half of the
  "do not re-implement 401 handling" item above. `identity.ts` now calls it too,
  keeping only the arm that is genuinely its own (an error token neither
  `invalid_token` nor absent). An `insufficient_scope` challenge falls through to
  `compute-rejected` rather than this layer inventing a third reading of a
  question 1c owns.
- ☑ **Done 2026-08-14. Write the Compute probe up as findings 13–20, and repoint
  every citation in the slice.** Not planned work — it came out of going to read
  "finding 13" before writing `contexts.ts` and finding that
  `PROBE-FINDINGS.md` stopped at 12. The Compute probe had been carried in
  scoping notes and cited from three shipped modules, and its numbers collided
  with the OAuth findings from the day before, so three correct modules were
  citing unrelated text. Re-probed read-only to confirm each fact rather than
  transcribing the notes, which is what caught the `jq` artifact above and
  sharpened two more (see the next two items).
- ☑ **`src/compute/contexts.ts` — resolve a context in one call, not two.** The
  summary item returned by
  `GET /compute/contexts?filter=eq(name,'…')` already carries a fully-formed
  `createSession` link — `POST`, with both `type` and `responseType` — so
  upstream's follow-up `GET /compute/contexts/{id}` is unnecessary (finding 15).
  Two traps. The filter is **string-interpolated with no escaping** upstream, so
  a context name containing an apostrophe breaks the query: the escape is
  **doubling the apostrophe**, confirmed against the deployment, where a
  backslash and the bare form are both a `400` with `errorCode` 1104. Escape,
  then percent-encode, with a test.

  And the collection reports **`"count": null`** — not always, but **exactly when
  the page does not already hold everything** (finding 16), including on the last
  page of a traversal. So a pager that trusts `count` fails precisely when paging
  matters, and reads "there are no compute contexts" — the one answer that is
  never true. Page on the presence of the `next` link and treat `items` as
  authoritative; nothing may branch on `count`.

  Done 2026-08-14. `quoteFilterValue` doubles, `contextFilter` composes, and the
  two "on the wire" tests drive the *real* client so the assertion is the literal
  URL — `?filter=eq(name%2C'Ford''s%20context')` — which pins the ordering, since
  encoding first leaves no quote to double. Two mirror-image tests pin the `count`
  rule: a `null`-count page with items that a count-trusting pager would report as
  empty, and a `count: 1` first page of two that it would truncate.
- ☐ **`src/compute/session.ts` — create, poll, delete.** Create by following the
  context's `createSession` link; the response is `201` with a `Location` and an
  `ETag`, and the session arrives in state `pending` with the links everything
  else navigates by.
- ☐ **Poll state with `wait` + `If-None-Match`, and no client-side timer**
  (finding 19). `GET …/state?wait=N` with a matching `If-None-Match` returns
  **`304` after exactly N seconds** — a real server-side long poll. Upstream
  declares this option and never passes it, waiting on the *log* endpoint
  instead, which conflates "has it finished" with "is there more log" and is why
  `ComputeJob.getState()` recurses under its author's own comment *"This is bad.
  We need to cache the last state value."* One round trip per window, no
  `setTimeout`, and the poll takes an abort signal so 2a-ii has somewhere to put
  a `CancellationToken`.
- ☐ **Fixtures captured from the probe, scrubbed per `test/fixtures/README.md`.**
  Hostname, session and context ids, the OAuth client id in `applicationName`,
  and both `owner` and `modifiedBy` (real email addresses) all have to go. Keep
  the envelope, field names, types and null/absent patterns exactly as the server
  sent them — the fidelity is the whole point, and per ADR-0010 these fixtures
  are what stands in for the specification we do not have.
- ☐ **Four things not to port**, all catalogued in the upstream survey. The
  process-global mutable `Configuration` singleton in `rest/common.ts` — it is
  why upstream cannot hold two connections at once, and multi-profile is a
  feature we already ship. `rest/context.ts` — dead, imported by nothing, and its
  line 93 passes a `RequestArgs` where an `AxiosRequestConfig` is wanted so the
  body would never be sent. The unbounded recursion in `session.ts::cancel()`.
  And `getLinkOptions`' message-less `new Error()`.
- ☐ **Raise the coverage ratchet.** This is 800–1,000 lines of pure logic with no
  `vscode` import, so it is measured, and ADR-0010 expects it to push the number
  **up**. If it does not, the tests are thinner than the slice.

```bash
# ⛔ BARRIER: merge 2a-i first.
# 2a-ii — the VS Code shell
git checkout -b phase-2a-ii-session-shell
git commit -m "feat(compute): bind compute sessions to profiles, with reconnect and death handling"
```

☐ **2a-ii punch list.**

- ☐ **A session belongs to a profile and borrows the provider's token.** Take it
  from `vscode.authentication.getSession`, never from storage directly, so
  expiry and sign-out flow through one place. Two profiles must be able to hold
  live sessions simultaneously — the thing upstream's global singleton forecloses.
- ☐ **Settle where the session id is persisted, and write down why.** Upstream
  uses `workspaceState`, which is per-window: two windows on the same folder
  would reconnect to the same compute session and interleave their output, and a
  window on a different folder loses a session that is still running and still
  billing. `globalState` keyed by profile id is the other candidate and has the
  opposite failure. Decide before writing the reconnect path, not during.
- ☐ **Session death is one recoverable event with three shapes.**
  `attributes.sessionInactiveTimeout` is **900 seconds** (finding 18), so this is
  routine rather than exceptional. A reaped session may answer `404`, may answer
  `401`, or may answer normally having lost its state — the probe did not observe
  which, so treat all three alike: say plainly that the session ended and the
  Python namespace is gone, and offer to start a new one. Do **not** copy
  upstream's `.catch(() => this._computeSession = undefined)`, which swallows
  every rejection including a network failure and reports it as a dead session.
- ☐ **Progress and cancellation.** `withProgress` around connect, and a
  `CancellationToken` wired to the abort signal 2a-i exposes. Upstream has no
  cancellation here and nowhere to add it.
- ☐ **The workspace-trust boundary applies.** 1c-i gates sign-in on trust;
  opening a compute session against a deployment is at least as consequential.
  Same gate, same message shape, and a test that asserts it.
- ☐ **An integration test per shell module.** ADR-0009 removed the threshold that
  would otherwise have noticed a missing one, and this punch list is the
  replacement gate.
- ☐ **Manual check against your Viya**: connect, confirm the session appears,
  reload the window and confirm it reconnects, then leave it idle past fifteen
  minutes and confirm the death path says something true.

> **⚠ 2-pre is a probe, and it gates the interface 2b freezes.** Do not skip it,
> and do not run it after 2b — that would be backwards.

☐ **2-pre.** Using the `viya-api-probe` skill and `creds.json`, settle three
things and record them in `PROBE-FINDINGS.md`:

1. **Injection.** Submit Python containing `endsubmit;` in a string, plus `%let`
   and `&sysuserid`. Does the block terminate early? Does SAS macro resolution
   fire? Then test `proc python file="…"` (upload the code to the session
   filesystem) as the injection-free alternative.
2. **Failure signal.** Is `SYSCC` readable from
   `GET /compute/sessions/{id}/variables/SYSCC`, or only from log text? **If only
   from log text, 3a depends on 3b** and the two must be reordered or merged.
3. **Reset.** How is the Python namespace cleared *without* destroying the compute
   session? If the only way is killing the session, `reset()` and the cancellation
   fallback both need redesigning — which is exactly why this runs before 2b.

```bash
# ⛔ BARRIER
# 2b — ExecutionBackend interface + dialects
git checkout -b phase-2b-backend-seam
git commit -m "feat(backend): define ExecutionBackend interface and Viya dialect layer"

# ⛔ BARRIER
# 2c — log streaming
git checkout -b phase-2c-log-streaming
git commit -m "feat(compute): add long-poll log streaming and ETag state polling"
```

### Phase 3 — Run Python

☐ **Before 3a — build the submission fidelity corpus, and let it choose the
mechanism.** SAS tokenises the block before Python ever sees it, and its string
rules are not Python's: a quote opens a literal that runs to the next matching
quote *across newlines*, so an apostrophe in a comment or a `don't` in a docstring
can leave the tokeniser inside an unterminated string that swallows the rest of
the submission — the failure that the `*';*";*/;quit;run;` incantation exists to
recover from. Macro triggers (`&name`, `%macro`) resolve inside double quotes and
not inside single ones, so the *same* Python behaves differently depending on
which quote style the user typed. SAS escapes a quote by doubling it, exactly as
the Compute filter does; a backslash is not an escape. And Python has quoting
forms SAS has never heard of — triple quotes, f-strings with nested quotes and
braces, raw and byte strings.

None of that is answerable by inspection, so write the corpus **first**: real
Python programs chosen to be hostile — apostrophes in comments and docstrings, an
odd quote count, triple-quoted strings holding both styles, f-strings with nested
quotes, raw and byte strings, `&` and `%` in literals, the token `endsubmit;` in a
comment *and* in a string, a `;`-heavy one-liner, CRLF endings, tabs, non-ASCII
identifiers and content, an empty file, and no trailing newline. Assert **byte for
byte** on what the interpreter received, not on what we sent, in the unit tier and
again in the live tier — the unit tier can only prove we built what we meant to
build, not that SAS agreed. Then pick the submission mechanism that passes it.
`proc python file="…"` is favoured precisely because a file transfer has no
tokeniser in the middle; if the inline form cannot pass the corpus, that is the
answer rather than a reason to iterate on an escaper. See `PRODUCTION_PLAN.md`
§1.5 item 1 and §4.

> **Why this gets its own item.** Every other failure in this project announces
> itself. This one does not: a mis-tokenised program runs and means something
> else, and the user's evidence for that is a wrong number, not an error.

```bash
# 3a — PROC PYTHON backend
git checkout -b phase-3a-proc-python-backend
git commit -m "feat(python): add PROC PYTHON execution backend with offset mapping"

# ⛔ BARRIER
# 3b — log filter
git checkout -b phase-3b-log-filter
git commit -m "feat(python): add SAS log to Python stdout filter"
```

> **⚠ 3c is a probe slice, not an implementation slice.** Do not let it start as
> "implement rich output." Run the probe, write up what the mechanism actually is,
> *then* size the implementation. This is the one slice in the plan whose scope is
> genuinely unknown, and pretending otherwise is how it swallows the phase.

☐ **3c step 1 — probe.** Using the `viya-api-probe` skill and `creds.json`,
determine how a matplotlib figure and a DataFrame HTML repr can be retrieved.
Candidates: write to the session filesystem and fetch via the Compute files API,
or base64 through the log. Record findings in `PROBE-FINDINGS.md`.

☐ **3c step 2 — size and split.** Turn the findings into one or more sized slices.

```bash
# 3c — rich output (scope set by the probe)
git checkout -b phase-3c-rich-output
git commit -m "feat(python): capture and return rich output"

# ⛔ BARRIER
# 3d-i — commands and text output (already shippable on its own)
git checkout -b phase-3d-i-commands
git commit -m "feat(python): add run/cancel/reset commands and output channel"

# ⛔ BARRIER
# 3d-ii — result panel webview
git checkout -b phase-3d-ii-result-panel
git commit -m "feat(python): add result panel webview with rich output renderers"

# ⛔ BARRIER
# 3e — runtime capability probe
git checkout -b phase-3e-runtime-capabilities
git commit -m "feat(backend): probe interpreter version and installed packages"
```

☐ **3e — ship the package list as a user-facing thing, not a capability record.**
The person writing code in this editor is writing against an interpreter they
cannot see, on a machine they cannot log into, whose package set someone else
chose and can change without telling them. Worse, the local environment lies with
conviction: Pylance resolves `import polars` against the laptop, so the editor is
green and the run is a `ModuleNotFoundError`. The minimum is a **`Python on Viya:
Show environment`** command listing the interpreter version, path, and installed
distributions with versions — read from `importlib.metadata`, not by shelling out
to `pip`, which need not exist in a compute context — plus a status bar affordance
that opens it and a per-profile cache with an explicit refresh, because it is a
slow answer that rarely changes. Phase 4's traceback work should special-case
`ModuleNotFoundError` and point at this list; Phase 10 feeds the set back to
Pylance so completions describe the remote environment. `PRODUCTION_PLAN.md` §2.3
and Phase 3e.

☐ **After 3d-i — probe cancellation.** Run a deliberately long Python step and
cancel it. Confirm whether the compute job cancel actually interrupts Python or
blocks until the step finishes. If it blocks, fall back to session reset with a
clear user-facing message, and log it in `PROBE-FINDINGS.md`.

☐ **Milestone.** This is the first genuinely useful build. Install the `.vsix`
locally and use it for real work for a few days before starting Phase 4. Real use
will reorder your priorities more reliably than the plan will.

### Phase 4 — Diagnostics

```bash
git checkout -b phase-4a-traceback-parsing
git commit -m "feat(python): parse Python tracebacks and map frames to editor positions"
# ⛔ BARRIER
git checkout -b phase-4b-diagnostics
git commit -m "feat(python): publish diagnostics to the Problems panel"
```

### Phase 5 — Hardening and release

```bash
git checkout -b phase-5a-drift-gate
git commit -m "test(dialects): complete REST contracts and harden the drift gate"
# ⛔ BARRIER
git checkout -b phase-5b-live-tests
git commit -m "test: add opt-in live Viya test tier with Viya 3.5 scaffold"
# ⛔ BARRIER
git checkout -b phase-5c-docs-release
git commit -m "docs: add user documentation and release workflow"
```

Then follow **Section D** to cut v0.1.0.

### Phases 6–12 — Breadth toward parity

☐ **Track parity against `PRODUCTION_PLAN.md` §3.1.** That table is the checklist;
tick capabilities off as phases land, and revise it when a decision changes.

Same loop. Branches: `phase-6a-content-adapter`, `phase-7a-library-adapter`,
`phase-8a-cas-browsing`, `phase-9a-notebook-format`, `phase-10a-package-listing`.
Phase 11 (remaining parity gaps) is sized when reached. Phase 12 (a second
execution backend) has no punch list by design — it is conditional on real usage
showing that `PROC PYTHON` hurts.

☐ **Before starting Phase 6**, re-read `PRODUCTION_PLAN.md` §3 and reorder 6–12
based on what users actually asked for after v0.1.0. The listed order is a
recommendation, not a dependency chain.

☐ **Phase 9a is a decision, not code.** Settle ipynb-compatible vs bespoke format
before writing the serializer.

---

## Section D — Release punch list

☐ **D1.** Finalise `CHANGELOG.md`: `[Unreleased]` → `[0.1.0] - YYYY-MM-DD`.
☐ **D2.** Set `version` in `package.json`.
☐ **D3.** Merge the release PR.
☐ **D4.** Tag from the merge commit on `main`:

```bash
git checkout main && git pull --ff-only && git tag v0.1.0
git push origin v0.1.0
```

☐ **D5.** Watch the release workflow; confirm the `.vsix` publishes to both the
VS Marketplace and Open VSX.
☐ **D6.** Install the published extension from the marketplace in a clean VS Code
profile and run one Python file end to end. Publishing green is not the same as
working.
☐ **D7.** Bump to the next `0.1.1-dev` version and add a fresh empty
`[Unreleased]` section.

> A published marketplace version cannot be reused. If something is wrong, ship a
> patch version — never try to republish the same number.

---

## Section E — AI reviewer bootstrap and smoke test

Do this immediately after 0a-ii merges. Full detail in `AI-PR-REVIEWERS-RUNBOOK.md`.

> **Steps 0–5 of that runbook are already done (2026-08-11).** The federated
> credential `sas-py-vscode-pr-review` exists on Entra app
> `1eec490f-1e17-4be7-a7cc-39cbc84c8147` for subject
> `repo:Shai-Alit/sas-py-vscode:pull_request`; the **Cognitive Services User**
> role is confirmed on SP `ab8a2947-ff16-4a9b-86b2-592eaea6c7e2` at the
> `sefordfoundry` account scope; all four secrets and four variables are set on
> the repo; and the three workflow files are written with prompts retailored for
> TypeScript. Only the merge (0a-ii) and this smoke test remain.

☐ **E1.** Confirm the workflows are on `main`. Nothing works until they are.

> **Also confirm the Claude GitHub App is installed on the repo** —
> https://github.com/apps/claude → Configure → repository access. This is a
> per-repo step, it is not Azure, and nothing in the workflow file or the Entra
> config hints at it. Without it `azure/login` succeeds and the action then dies
> with `401 Unauthorized - Claude Code is not installed on this repository`.
> Installed here 2026-08-12.

☐ **E2.** Create a throwaway branch with deliberately bad code. Seed it with
defects that match the *retailored* prompts, so a silent bot and a working bot
look different: a `fetch` with no timeout, an empty `catch` with no fail-soft
comment, `Math.random()` in a PKCE verifier, a token written to `console.log`, a
user-facing string not wrapped in `l10n.t()`, an `as any` cast across an API
boundary, and an inline `if (version === "3.5")` outside `src/dialects/`. A
reviewer that misses **all** of those is misconfigured, not merely quiet.

The file `test/scratch/reviewer-smoke.ts` is already prepared in your working copy.

```bash
git checkout main && git pull --ff-only && git checkout -b ci-reviewer-smoke-test
git add test/scratch/reviewer-smoke.ts
git commit -m "test: reviewer smoke test"
git push -u origin ci-reviewer-smoke-test
gh pr create --base main --head ci-reviewer-smoke-test --fill
```

☐ **E3.** Confirm **both** reviewers post inline comments plus a summary.

☐ **E4.** For the Claude reviewer, open the Actions log and check the success
signals: `is_error: false`, `subtype: success`, `num_turns > 1`, a real non-zero
`total_cost_usd`, and `modelUsage` entries with `provider: "foundry"`.

> **If `azure/login` fails with `AADSTS700213: No matching federated identity
> record found`:** the repo is emitting GitHub's *immutable* OIDC subject. Repos
> created, renamed, or transferred after **2026-07-15** present
> `repo:<owner>@<ownerId>/<repo>@<repoId>:pull_request` instead of the classic
> `repo:<owner>/<repo>:pull_request`, and Entra matches the subject as an exact
> string. Copy the subject **verbatim from the error** — it is authoritative, and a
> hand-derived one reproduces the same opaque failure — then add a second federated
> credential carrying it. Fixed here on 2026-08-12 by adding
> `sas-py-vscode-pr-review-immutable`. This is why `viyapy`, which predates the
> cutoff, was unaffected.
>
> **If you see `is_error: true`, `num_turns: 1`, `$0`, and a flat ~180s duration:
> that is not a hang.** It is the SDK retrying a 401 ten times. The cause is
> almost always a missing **Cognitive Services User** role on the service
> principal at the Foundry *account* scope. Fix the RBAC, then use GitHub's
> "Re-run failed jobs" — OIDC re-authenticates each run, so no new commit needed.

☐ **E5.** **Close the smoke-test PR without merging** and delete the branch. The
bad code must never reach `main`.

```bash
gh pr close ci-reviewer-smoke-test --delete-branch
```

---

## Section F — Cross-cutting reminders

These apply to every slice. Most PR review comments trace back to one of them.

- **Every PR needs a `CHANGELOG.md` entry** under `[Unreleased]`. CI should fail
  without one.
- **Ported code keeps its SAS copyright header** and gains ours. This is an
  Apache-2.0 obligation, and the header check enforces it.
- **Never branch on Viya version inline.** It goes in `dialects/`. If you find
  yourself writing `if (version === "3.5")` outside that directory, stop.
- **Never copy logic under test into a test file.** That is the SAS extension's
  mistake and the reason its REST layer is effectively untested. Mock at the HTTP
  boundary instead.
- **Audit ported security code, don't transcribe it.** Upstream's PKCE verifier
  uses `Math.random()`. Assume there are others.
- **Never change how Python reaches the interpreter without running the fidelity
  corpus.** Once Phase 3a exists, that corpus is load-bearing: SAS tokenises the
  block before Python sees it, and a quoting mistake does not raise — it produces a
  program that runs and means something else.
- **User-facing strings go through `l10n.t()`.**
- **No secrets in fixtures.** Sanitise hostnames, tokens, user names, and paths
  when recording. Secret scanning runs in CI but should never be the thing that
  catches it.
- **Probe before implementing** against an unverified endpoint. Record findings in
  `PROBE-FINDINGS.md` and cite them in the PR description.
- **New user-facing setting or command?** Add it to `package.json` contributions;
  the docs reference is *generated* from there, so never hand-edit the tables —
  regenerate them and commit the result, or CI will fail the diff check.
- **Docs ship with the slice, not at the end** (`PRODUCTION_PLAN.md` §4.1). A
  behaviour change with no doc change is an incomplete PR.
- **Settled a §6 open decision? Write the ADR** in `docs/adr/` in the same PR.
  The code records what; only the ADR records why.
- **Keep `main` releasable.** If a slice leaves the extension unusable, it was
  scoped wrong.

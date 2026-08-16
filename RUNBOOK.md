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

☑ **A1. Done; confirmed 2026-08-16.** `main` is the default branch —
`origin/HEAD` resolves to `origin/main`.

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

☑ **Superseded 2026-08-16.** 0a-ii merged; the Section E smoke test was never run
as written, because the reviewers were proved in production instead. They have
posted inline comments and summaries on slice PRs since, and several of their
findings were filed and fixed as tasks — #113, #115, #127, #128, #129. That is
the same evidence E3 and E4 were designed to produce, obtained the expensive way.
Original intent, kept for the record: do not start 0b until both bots have
demonstrably posted on the smoke-test PR — if they're broken, you want to know
now, not after four more slices have merged unreviewed.

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

☑ **Done 2026-08-13, after `changes` was added.** Make it **ten**: `changes`
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

**Re-read off the live rule 2026-08-16: the required set is now twelve.** The ten
above, plus `supply-chain` and `analyze` — the two boxes further down this file,
both of which were done at the time and left unticked. The twelve are `changes`,
`verify`, `docs`, `package`, `supply-chain`, `analyze`, and the six
`test (os, node)` legs. Before re-deriving any of this from `ci.yml`, read the
"sharp edge" paragraph in [docs/dev/ci.md](docs/dev/ci.md) — that is the
authoritative statement of why `changes` is required, and `ci.yml` alone does not
say so.

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

☑ **Done; confirmed on the live rule 2026-08-16.** The new `supply-chain` check
was added to branch protection after it first reported — same `PUT` as above,
which re-derives the contexts from what actually ran.

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

☑ **Done; confirmed 2026-08-16.** The repository-side settings are on (all free
on a public repo, and this repo went public 2026-08-12): Dependabot alerts,
secret scanning, push protection, and private vulnerability reporting. Secret
scanning and push protection were the last two, enabled 2026-08-16 — the other
two had been on since the repo went public and, as with branch protection, the
box was simply never ticked.

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

☑ **Closed 2026-08-16 — not available on this repository.** The reasoning for
wanting it stands: provider patterns match known vendor formats, an AWS key or a
GitHub token, and **a SAS Viya bearer token is a plain JWT that no vendor pattern
claims**, so provider-only scanning does not cover the one credential this project
actually handles. Generic-pattern detection is the arm that would.

It cannot be turned on here. The `PATCH` below was run and returned **200 with the
field still `disabled`** — the repository-update endpoint silently drops
`security_and_analysis` sub-fields it will not accept, so a no-op is
indistinguishable from success on the wire. The UI settles it: under **Settings →
Advanced Security** there is no *Scan for non-provider patterns* control at all,
and no upsell either. Absent, not merely off. The likely gate is paid GitHub
Secret Protection, but that was not confirmed and the distinction does not change
the outcome.

**Closed rather than left open, because the compensating control is already the
stronger one.** `scripts/check-secrets.mjs` carries a `jwt` rule —
`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` — plus a
`bearer-header` rule, and that file's own doc comment says it exists precisely
because GitHub's partner patterns will never match a Viya token. It runs in CI on
every run. Buying GitHub Advanced Security to obtain a second, weaker net under a
risk already covered by a tested first-party check would be the wrong call on a
side project, so this is a decision, not a deferral. Revisit only if this repo
moves under a SAS organisation that already licenses Secret Protection, where it
would cost nothing.

The one thing generic-pattern scanning would add that `check:secrets` does not:
it scans **history**, while ours scans the working tree. That gap is accepted, and
push protection — which *is* enabled — covers the direction that matters, a
credential arriving in a new push.

```bash
# Ran, returned 200, changed nothing. Kept as the record of what was attempted.
echo '{"security_and_analysis":{"secret_scanning_non_provider_patterns":{"status":"enabled"}}}' | gh api -X PATCH repos/Shai-Alit/sas-py-vscode --input -
```

☑ **Done; confirmed on the live setting 2026-08-16.** A3 above says the repo is
squash-merge only. The 2026-08-16 API response said `allow_squash_merge: true`,
`allow_rebase_merge: false`, and `allow_merge_commit:` **`true`** — so the claim
was not backed by the configuration. Nothing had gone wrong, because branch
protection's linear-history rule blocks a merge commit on `main` regardless; but a
record that says one thing while the config says another is the defect this
section has already been bitten by twice. `allow_merge_commit` is now `false`, and
unlike the box above this one applied cleanly — a plain repository setting with no
licensing behind it, so the `PATCH` did what it said.

```bash
gh api -X PATCH repos/Shai-Alit/sas-py-vscode -F allow_merge_commit=false
```

☑ **Done 2026-08-16.** **Settings → Actions → General → Fork pull request
workflows** now requires approval for **all outside collaborators**. It had been
on the public-repo default, *Require approval for first-time contributors*, which
auto-runs a returning outside contributor's pull requests. Deferred from the
going-public audit; no workflow uses `pull_request_target`, so fork PRs could not
reach the Azure secrets even before this, but it closes the door rather than
relying on that holding — and it keeps working if a later workflow does have
access, without anyone having to remember this reasoning at that moment.

☑ **Done; confirmed on the live rule 2026-08-16.** `analyze` (CodeQL) was added
to branch protection once it had reported — same `PUT` as the 0d-i one,
re-derived from the contexts that actually ran. It is in a different workflow
from the rest, which changes nothing: required checks are matched on job name.

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

☑ **Done; confirmed 2026-08-16.** Verified by hand against the live deployment
after 1c: sign in, reload the window, the session persisted and the Accounts menu
showed the identity; a second profile pointing at a different deployment appeared
as a **second** account, and signing out of one left the other signed in. That is
decision 10, and it was the behaviour a single review pass was most likely to
miss. Original text kept above in spirit; the box was left unticked at the time
and the confirmation is recorded here late.

The second profile pointed at a genuinely different Viya deployment, not a second
name for the same one, which is the only version of this test worth running.

**Why this passed and #84 still failed later.** The Connect command did not exist
yet. `runConnect` first appears in `b356f6b` (2a-ii, PR #23); this box belongs to
1c-i (`4d87bb8`, PR #19). So what was proved here is the **sign-in and identity**
path — `getSessions()`, which is what the Accounts menu polls and which walks
every profile — and that proof still stands. #84 was not a regression in it. It
was a **new caller**: `runConnect` asked for a session with no `account` hint, and
the host substituted the account it happened to remember, opening the browser on
the first profile's deployment. Nothing in the 1c surface ever gave the host that
opportunity.

That is the part worth carrying forward. A host behaviour can sit dormant through
an entire slice's hands-on verification and surface the moment a second caller
reaches the same API by a different route — so "the two-profile case is proved"
is a claim about the callers that existed when it was proved, and it expires
quietly every time a new one is added. See #137 for the fix
(`clearSessionPreference`, first appearing in `da6ccb0`).

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

☑ **2a-i punch list.** Complete 2026-08-14.

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
- ☑ **`src/compute/session.ts` — create, poll, delete.** Create by following the
  context's `createSession` link; the response is `201` with a `Location` and an
  `ETag`, and the session arrives in state `pending` with the links everything
  else navigates by.

  Done 2026-08-14, with `cancel` included — finding 21 put the link in front of
  us and it is the direct replacement for the unbounded recursion listed below.
  Three decisions worth keeping. **`Location` is ignored**: the `201` body already
  carries all 22 links, so following it would buy a second round trip for a
  representation we were handed. **Only one state name is written down.**
  `waitWhilePending` waits for `pending` to end and hands the caller whatever came
  next without judging it; a hand-maintained list of "done" states is how upstream
  ended up with `ComputeJob.isDone()` returning `true` when the job is not done.
  **A 401 is not a gone session.** `problems.ts` said to fold it into
  `session-gone`; that comment is now corrected, because a caller acting on it
  would create a new session with the credential that just failed and go round
  again. `asSessionGone` rewrites a 404 and nothing else.
- ☑ **Poll state with `wait` + `If-None-Match`, and no client-side timer**
  (finding 19). `GET …/state?wait=N` with a matching `If-None-Match` returns
  **`304` after exactly N seconds** — a real server-side long poll. Upstream
  declares this option and never passes it, waiting on the *log* endpoint
  instead, which conflates "has it finished" with "is there more log" and is why
  `ComputeJob.getState()` recurses under its author's own comment *"This is bad.
  We need to cache the last state value."* One round trip per window, no
  `setTimeout`, and the poll takes an abort signal so 2a-ii has somewhere to put
  a `CancellationToken`.

  Done 2026-08-14. Two things the writing turned up. The request timeout has to
  **outlive the server's wait** — the client's 30-second default would abort a
  60-second poll a moment before it was answered, and the failure would read as an
  unreachable deployment, so the poll sends its own `timeoutMs` of `wait + 15s`.
  And a `304` is returned as `{ changed: false }` carrying **no state at all**, so
  that a caller structurally cannot do what upstream does and re-fetch the value
  it just declined to be sent. The bound on the loop is `MAX_WAIT_WINDOWS`, which
  exists for the case the probe has not seen: a deployment that answers a bare
  `?wait=N` immediately, with no validator to compare against, would otherwise
  spin.
- ☑ **Fixtures captured from the probe, scrubbed per `test/fixtures/README.md`.**
  Hostname, session and context ids, the OAuth client id in `applicationName`,
  and both `owner` and `modifiedBy` (real email addresses) all have to go. Keep
  the envelope, field names, types and null/absent patterns exactly as the server
  sent them — the fidelity is the whole point, and per ADR-0010 these fixtures
  are what stands in for the specification we do not have.

  Done 2026-08-14: `test/fixtures/viya4/compute-session-created.json`, the `201`
  from the consented mutating probe, with the session id, the OAuth client id in
  `applicationName` and the owner's address replaced. The create test reads it
  rather than a hand-built object, so a deployment that changes shape fails a
  test instead of surprising a user.
- ☑ **Four things not to port**, all catalogued in the upstream survey. The
  process-global mutable `Configuration` singleton in `rest/common.ts` — it is
  why upstream cannot hold two connections at once, and multi-profile is a
  feature we already ship. `rest/context.ts` — dead, imported by nothing, and its
  line 93 passes a `RequestArgs` where an `AxiosRequestConfig` is wanted so the
  body would never be sent. The unbounded recursion in `session.ts::cancel()`.
  And `getLinkOptions`' message-less `new Error()`.

  Two more found while writing this slice, so the item is really six. `ComputeJob`
  `.isDone()` tests `doneStates.indexOf(state) === -1` and therefore answers
  `true` for a job that is **not** done — it is dead code, which is the only
  reason nobody has been bitten by it, and it is the argument for naming as few
  states as possible rather than keeping a list. And `createSession` hardcodes
  `name: "mysess"`, `description: "This is a session"`, which is what an
  administrator sees in Environment Manager; ours says `python-on-viya`,
  unlocalised on purpose so it stays searchable.
- ☑ **Raise the coverage ratchet.** This is 800–1,000 lines of pure logic with no
  `vscode` import, so it is measured, and ADR-0010 expects it to push the number
  **up**. If it does not, the tests are thinner than the slice.

  Done 2026-08-14: 82/82/82/91 → **88 lines, 88 statements, 87 functions, 93
  branches**, from a measured run rather than a hopeful one. `src/compute` came
  out at 99.72% of statements and 96.25% of branches, with `session.ts` at 100%
  across the board; the overall figure is held down by `scripts/`, which is build
  tooling and not shipped code. Closing the last of `session.ts`'s branches was
  worth doing on its own merits — they were the "read, never assume" paths, and
  the tests that cover them are the ones that say a deployment reporting no
  usable `sessionInactiveTimeout` must leave us saying nothing rather than
  guessing 900.

```bash
# ⛔ BARRIER: merge 2a-i first.
# 2a-ii — the VS Code shell
git checkout -b phase-2a-ii-session-shell
git commit -m "feat(compute): bind compute sessions to profiles, with reconnect and death handling"
```

☐ **2a-ii punch list.**

- ☑ **A session belongs to a profile and borrows the provider's token.** Take it
  from `vscode.authentication.getSession`, never from storage directly, so
  expiry and sign-out flow through one place. Two profiles must be able to hold
  live sessions simultaneously — the thing upstream's global singleton forecloses.

  Done 2026-08-14. `ComputeSessionManager` holds a `Map` keyed by profile id, so
  two profiles hold two sessions and neither can overwrite the other. The token
  is **borrowed per request, never stored**: `ComputeClientConfig.token` is a
  function, and it calls `getSession(…, { silent: true })` each time, because a
  900-second session outlives the access token that opened it and the provider's
  own refresh path is the only thing entitled to renew it. Nothing here reads
  `SecretStorage`.

  One guard that was not on this list. `vscode.authentication.getSession` lets
  the **user** pick the account when several profiles are signed in, and the
  provider's session id *is* the profile id — so the manager compares them and
  refuses when they differ, rather than opening a session on a deployment the
  user did not select. Cheap, and it closes the hole behind task #84.
- ☑ **Settled 2026-08-14: the session id lives in `workspaceState`, keyed by
  profile id — one session per (workspace, profile).** Recorded as **ADR-0012**;
  the reasoning is there and is not repeated here. What the implementation has to
  honour:
  - The stored id is a **hint, not a fact**. Validate it by using it and catching
    the failure; never probe first. Finding 29 makes that cheap and unambiguous.
  - **Two windows on the same folder deliberately share one session.** That is the
    store's grain and this decision accepts it rather than pretending otherwise.
    It is why the busy check below exists, and it must be said in the docs.
  - **`globalState` is rejected**, because a session that follows the user across
    unrelated folders lets a scratch window inherit a production namespace — the
    same shape ADR-0002 and ADR-0011 restrict for the target.
  - **Do not delete the session on `deactivate`.** Persisting the id and reaping
    on exit are contradictory; a reload is the case this exists for. The 900-second
    timeout is the reaper, and an explicit *Disconnect* command is the manual one.
  - **Do not build reclaim-by-listing.** It looked attractive and the probes talked
    us out of it — see ADR-0012's alternatives and findings 25 and 26.
- ☐ **Refuse to submit into a busy session, and say so.** Finding 27: the session
  state reads `running` while a job executes and returns to `idle` after. Check it
  before submitting; if it is `running`, say the session is busy rather than
  submitting concurrently, because finding 29's "what did not settle" list has
  concurrent submission on it as unobserved. This is also the only defence the
  shared-session case has, so it is not optional.

  **Moved to 3a on 2026-08-14, unstarted.** It was mis-scoped onto this slice:
  the check has no caller until there is a submission path to refuse, and a
  state read written now would be dead code with a test that only proves it
  parses. It stays not optional — it moves with its reasoning intact, and the
  header of `src/compute/sessionManager.ts` says under "what is deliberately not
  here yet" why the manager has no busy check.
- ☐ **Poll the *job* for completion, never the session.** Finding 27 measured the
  job reaching `completed` two to three seconds before the session returned to
  `idle`. Use the job's `state` link, and send `wait` **and** `If-None-Match`
  together — finding 28 measured `wait` alone returning immediately, which would
  turn the poll into a hot spin that still looks correct.

  **Moved to 3a on 2026-08-14, unstarted**, for the same reason as the item
  above: there is no job to poll until something submits one. The *session*
  long poll it is contrasted with did land in 2a-i (`waitWhilePending`), so the
  mechanism is built and tested; what moves is only the choice of resource.
- ☑ **Session death is one recoverable event with one observed shape.**
  `attributes.sessionInactiveTimeout` is **900 seconds** (finding 18), so this is
  routine rather than exceptional. Finding 29 measured a dead session answering
  **`404`** identically on the session, its state, and a job submission — so key
  on the **status**, not on `errorCode` 5837. Say plainly that the session ended
  and the Python namespace is gone, and offer to start a new one; do **not** state
  a cause, because a `404` cannot distinguish expiry from deletion from an id that
  never existed. Keep handling a `401` as *auth*, not as death. Do **not** copy
  upstream's `.catch(() => this._computeSession = undefined)`, which swallows
  every rejection including a network failure and reports it as a dead session.

  Done 2026-08-14, and it turned out to be quieter than the item implies. A
  stored id is tried with `attachSession`; `session-gone` — which 2a-i already
  narrows to a `404` and nothing else — is written to the **log**, saying that
  anything defined in the old session is gone, and the binding is cleared. The
  connect then carries straight on and creates a new session.
  The user is told what happened by the notification they get at the end, which
  says they are connected. There is no "your session ended, start another?"
  prompt, because after a reload the answer is always yes and the prompt is
  purely a click. Every *other* failure of the reattach is reported and the
  connect stops — the discrimination upstream's blanket `.catch` throws away.

  The one place death is announced is a reattach the user asked for and that
  failed for a reason other than a `404`; the wording comes from
  `localiseComputeProblem`, so it names the deployment's own reading of the
  failure rather than assuming a cause.
- ☑ **The session `name` carries a constant marker and nothing else.** Finding 25:
  the identity `id` is an email address on at least one deployment, and a session
  name is readable by other callers listing the collection. `python-on-viya` is
  the marker; the user narrowing comes from `owner`, which the server already
  knows and did not learn from us.

  Landed in 2a-i's `createSession` and unchanged here; the shell passes no name
  of its own, so there is nowhere for a user string to leak into one.
- ☑ **Progress and cancellation.** `withProgress` around connect, and a
  `CancellationToken` wired to the abort signal 2a-i exposes. Upstream has no
  cancellation here and nowhere to add it.

  Done 2026-08-14 through `abortOn(token)`, disposed in a `finally` so a
  completed connect does not leave a listener on a token source that outlives
  it. One thing the writing turned up: a cancelled request comes back as
  `compute-unreachable`, indistinguishable from a deployment that is genuinely
  down, so `reportFailure` checks `token.isCancellationRequested` first and
  shows **nothing**. A user who pressed Cancel does not need to be told the
  deployment is unreachable.

  Connect is also **re-entrant**: a second invocation joins the promise in
  flight rather than starting a second connect, because the two would each
  create a session and one of them would be orphaned for 900 seconds.
- ☑ **The workspace-trust boundary applies.** 1c-i gates sign-in on trust;
  opening a compute session against a deployment is at least as consequential.
  Same gate, same message shape, and a test that asserts it.

  Done 2026-08-14, twice over: the manager refuses before it reads a profile,
  and `contributes.commands` carries `isWorkspaceTrusted` in *Connect*'s
  `enablement` so the palette does not offer a command guaranteed to fail. The
  integration test asserts zero requests were made, not just that a message
  appeared — the gate has to be in front of the network, not beside it.
- ☑ **An integration test per shell module.** ADR-0009 removed the threshold that
  would otherwise have noticed a missing one, and this punch list is the
  replacement gate.

  Done 2026-08-14: `test/integration/compute/` gained `messages`,
  `session-manager` and `commands`, one per `vscode`-importing module added by
  this slice, and the three new entries in `.c8rc.json` are the same three
  names. The session-manager suite keys its fake deployment **by link relation**
  rather than by call order, so a change in how many requests connect makes does
  not silently re-point a reply at the wrong endpoint.

  `bindingStore.ts` started here as a fourth and is not one. Lint asked for
  `import type * as vscode` — it uses two interfaces and no value — and ADR-0009
  reads a type-only import as no import at all, so the module belongs in the
  denominator and its suite belongs in the unit tier. It moved to
  `test/unit/compute-binding-store.test.ts`, its `.c8rc.json` entry came out,
  and the constructor now takes `Pick<Memento, "get" | "update">` and
  `Pick<LogOutputChannel, "debug">` in the house style. The lint rule found a
  tier mistake, which is the second time a mechanical check has been better at
  this than the judgement that put the file there.
- ☑ **Not on the original list: a profile with no `context` gets a picker, and
  the answer is written back.** `contextFor` lists the deployment's compute
  contexts, asks, and then `profiles.upsert`s the chosen name into the profile,
  so the question is asked once rather than on every connect. Dismissing the
  picker cancels the connect and shows nothing. A deployment that returns no
  contexts at all is refused with an administrator-facing message, because
  there is no answer the user could give.

  Worth confirming rather than assuming: it edits the user's settings as a side
  effect of connecting. The alternative — hold the choice in memory for the
  session — asks again after every reload, which is the worse of the two.
- ☑ **Re-baseline the ratchet from the measured run.** Most of this slice is
  shell and therefore outside the denominator, but `binding.ts`,
  `cancellation.ts` and now `bindingStore.ts` are all measured and heavily
  tested, so the number should not fall.
  Set it from `npm run coverage`, not from a guess; if it drops, something in
  `src/compute` lost a test rather than the slice being untestable.

  Done 2026-08-14: measured 89.49 statements, 94.25 branches, 88.54 functions,
  89.49 lines across 593 unit tests; floor set to **89 / 89 / 88 / 94**, each
  rounded down so a three-OS gate cannot fail on a rounding difference. It rose,
  which was the prediction: `src/compute` now measures 99.78 with `binding.ts`,
  `bindingStore.ts`, `cancellation.ts`, `links.ts` and `session.ts` all at 100.
  The drag is still `scripts/` at 64.76, unchanged and unmoved by this slice —
  the argument flagged after the 1b-i re-baseline is still waiting for its own
  slice, and this number will keep pointing at it until it gets one.
- ☑ **Manual check against your Viya.** Run 2026-08-15; what it found is
  recorded below it. **Superseded by the 2a-iii procedure** at the end of that
  slice, which starts from the same cold state and covers these steps as well —
  run that one rather than this one. Kept here because the findings underneath
  it only make sense against the steps that produced them.

  Nothing below is reachable from an
  automated test: the integration host cannot sign in to a real deployment,
  cannot be made untrusted, and cannot wait fifteen minutes. Written out in full
  because "connect and see if it works" is how a manual check becomes a manual
  check that was never run.

  **Setting up.** Open the repo in VS Code and press `F5` — the *Run Extension*
  launch configuration builds first and opens an Extension Development Host.
  **Ignore the *Run Extension (untrusted workspace)* configuration**: its
  `--disable-workspace-trust` flag turns the trust *feature* off, which trusts
  everything, so it does the opposite of its name. It is on the unfiled list.

  In the dev host, **open a folder** (`File ▸ Open Folder`) — a scratch folder
  will do, but it must be a folder, because the binding lives in
  `workspaceState` and there is none without one. Trust it when asked.

  **Every command below is run from the Command Palette**: `Ctrl+Shift+P`, type
  the title shown in italics, press Enter. They all appear under a **Python on
  Viya** category, so typing that shows the lot. This sentence exists because
  its absence is what made the first run of this procedure fail — a reader who
  has never used the extension cannot be expected to infer where "*Connect*"
  lives, and every step below is worthless until they can find it.

  Then run
  *Python on Viya: Show Log* and set the channel to **Debug** from the gear in
  the panel title, or the *Developer: Set Log Level…* command. Several lines
  below are `debug` and are invisible at the default level.

  1. **Add a profile with no compute context.** *Python on Viya: Add Connection
     Profile*, name it, give it your endpoint, and **leave the context empty** —
     that is what puts the picker on the path.
  2. **Connect.** *Python on Viya: Connect to SAS Viya*. Expect, in order: a
     browser sign-in the first time, a *Reading compute contexts…* progress, a
     quick pick of context names, then *Connecting to SAS Viya…*. The log should
     end with `Started a SAS Viya session on compute context "…"`.
  3. **The write-back landed.** Open `settings.json` and confirm
     `pythonOnViya.connectionProfiles.<name>.context` now holds what you picked.
     This is the item flagged as worth confirming rather than assuming: it edits
     the user's settings as a side effect of connecting.
  4. **Reconnect across a reload.** *Developer: Reload Window*, then *Connect*
     again. The log must say `Reconnected to the SAS Viya session for this
     folder`, and it must **not** say `Started a SAS Viya session` — a second
     "Started" means the stored id was not used and a SAS process was orphaned.
     No context picker this time either, since step 3 wrote the answer down.
  5. **The death path.** Note the time of the *first* connect: the idle timeout
     is 900 seconds from the session's last activity, and nothing touches it in
     between. Reload the window, wait until **sixteen minutes** past that, then
     *Connect*. Expect `The previous SAS Viya session has ended, so a new one
     will be started. Anything defined in it is gone.` at `info`, followed by a
     new `Started` line — and no error dialog, because a session ending on its
     own schedule is ordinary. This is the one step that cannot be hurried.
  6. **Two profiles at once.** Add a second profile, *Switch Connection
     Profile* to it, *Connect*. Expect a second `Started` line. Switch back to
     the first and *Connect* again: it should return instantly and add **no**
     new log lines at all, because that connection is still held in this
     window's map. One session per profile is the whole point of the `Map`.
  7. **Disconnect.** *Python on Viya: Disconnect from SAS Viya* → `Ended the SAS
     Viya session.` Then *Connect* once more: a `Started` line rather than a
     `Reconnected` one is what proves the binding was cleared rather than
     merely forgotten in memory.
  8. **Cancellation says nothing.** Press Cancel on the *Connecting to SAS
     Viya…* notification: no error dialog, and `Connecting to SAS Viya was
     cancelled.` in the log. Then repeat for the arm the review caught — clear
     the profile's `context` in `settings.json`, *Connect*, and Cancel the
     *Reading compute contexts…* progress instead. Before the fix that showed
     "could not reach the compute service"; it should now show nothing.
  9. **Trust.** *Workspaces: Manage Workspace Trust* → Restricted Mode. Neither
     *Connect* nor *Sign In* should appear in the Command Palette at all —
     VS Code removes a command whose `enablement` is false rather than dimming
     it. The manager's own refusal behind that gate is covered by an integration
     test; what only a human can confirm is that the palette entry is gone
     rather than merely failing when run.

  **Optional cross-check from the Viya side.** The session id is deliberately
  never logged, so find it by listing instead: with the `viya-api-probe` skill
  and `creds.json`, `GET /compute/sessions` and look for the one whose `name` is
  `python-on-viya`. Doing this between steps 7 and its re-connect is the only
  way to see, from outside the editor, that *Disconnect* really took the session
  down rather than just dropping our reference to it.

**What the first run of that procedure found, 2026-08-15.** Steps 6 and 7 passed
as written. The rest produced five defects, none of them in the code this slice
changed and none of them fixed here — they are the next slice, taken on a fresh
branch rather than reopening a pull request that has already been through two
review rounds.

- **A second connection profile is unreachable** (task #84, rewritten from a
  docs correction into this). *Switch Connection Profile* moves the active
  profile correctly — the quick pick's "Currently in use" detail proves
  `activeName()` is right — and then *Connect* acts on the other deployment
  anyway. `runConnect` asks for a token with
  `getSession(id, [], { createIfNone: true })`, and **VS Code chooses the
  account, not us**: it silently reuses the account it remembers for this
  extension rather than prompting. The `auth.id !== active.profile.id` guard
  then refuses with advice — *run Switch Connection Profile* — that the user has
  just followed. The fix is `AuthenticationGetSessionOptions.account`, present in
  `@types/vscode` at our `^1.104.0` floor and documented as "passed down to the
  Authentication Provider"; our `getSessions` and `createSession` currently
  ignore their `options` argument entirely. Generalisable: **a guard that
  refuses the wrong answer is not a substitute for asking the right question.**
  Step 6 passed only because both connects happened to land on the account
  VS Code already remembered.
- **A cancelled sign-in is reported as a failure** (#131). `browserFlow.ts` gets
  it right — `Sign-in was cancelled.` at `info`, with a comment saying neither
  arm is an error and neither gets a dialog — and then `createSession` collapses
  its `undefined` into a generic throw, which the sign-in command reports as
  `[error] Signing in to SAS Viya failed: …` with a dialog. Same family as #127,
  and the same lesson: the fact is known at the bottom and lost at the boundary.
  Note the constraint on the fix — an error thrown from `createSession` reaches a
  caller that went through `vscode.authentication.getSession`, so it crosses an
  RPC hop and `instanceof` will not survive it.
- **`resolve()` says nothing when there is nothing stored** (#132). Of its three
  ways to return `undefined`, two warn and one is silent by explicit decision.
  That is right for an Accounts-menu poll and wrong for the first reload after a
  sign-in, and it is why step 4's failure could not be diagnosed from the log at
  all. A `debug` line naming the endpoint costs nothing at `info`.
- **One unreachable profile stalls every connect** (#133). `getSessions()` walks
  the profiles serially and renews each, so a deployment that is down costs a
  full connect timeout and an alarming `Could not renew the sign-in for
  <endpoint>` line before the profile the user actually selected is looked at.
  Not a correctness bug; it is what made a working connect look broken.
- **Sign In should connect** (#134, a design change rather than a defect). Two
  commands to reach one outcome is friction with no payer: there is no other
  reason to sign in to a compute server. Our own *Sign In* connects afterwards;
  the **Accounts-menu** sign-in deliberately does not, because that menu fires
  whenever anything asks for a session and starting a SAS process from a menu
  click is the wrong trade. *Connect* stays for reconnecting after an explicit
  *Disconnect*, and Phase 3 adds a third path that connects on demand — upstream
  has no Connect command at all for exactly this reason. The cost worth stating
  once: a session holds a launcher slot for fifteen idle minutes, so signing in
  to check you are signed in now costs one.

**A second run, 2026-08-15 afternoon, with the profiles cut back to one.** Step B
passed outright — `Reconnected to the SAS Viya session for this folder.` after a
*Developer: Reload Window* — which retrospectively explains the morning's
"reload made me sign in again": that was #84 wearing a disguise, not a broken
reattach. ADR-0012's central claim is confirmed against a live deployment.

Step A found the one defect in this slice's own code that was worth fixing here
rather than deferring, and it is fixed on this branch. The picked context was
written back to the profile **before** the connect was attempted. A context
offering no `createSession` link was picked, the connect failed — and because
`contextFor` returns early for any profile that already has a context, the
picker was then unreachable and every later connect failed the same way. The
only escape was hand-editing `settings.json`. `runConnect` now writes the pick
only once `open` has returned a connection, pinned by an integration test that
scripts a context with no links and asserts nothing was written. The
generalisable form: **a value learned by asking the user is not a fact until the
thing it was needed for succeeded.**

That fix was itself wrong on its first attempt, which review caught before it
merged and which is worth recording because the mistake is a repeat. Moving the
write to after the connect meant it now ran *after a round trip*, and the code
carried the profile it had connected with while asking the store which name was
active **now**. Switch Connection Profile mid-connect and those name two
different profiles, so the write would have put the connected profile's
endpoint and id under the newly active profile's name — destroying a profile the
user had done nothing to, silently. It now re-reads the profile under the
captured name and writes only if it is still the same deployment. This is the
third instance of one lesson (#127 was the first, the write-before-success the
second): **a value that was true when the work started is not a fact about the
world when the work finishes** — and moving code later in a sequence is exactly
what turns the first into the second.

Not fixed, because it is not understood: the *same* context started a session
two minutes later without complaint. Filed as probe task #135 — if a context's
link set depends on the token presented, `contexts.ts` is wrong to read an
absent `createSession` as a permanent property of the deployment, and the
message it writes is misleading. `docs/connecting.md` says so plainly for now.

Step 3 is **unconfirmed rather than failed**: `settings.json` showed no
`context` after what looked like a successful connect, but the run never
established whether the picker appeared, and #84 means the connect may not have
been acting on the profile being inspected. Re-check it after #84 lands before
concluding anything about the write-back.

**Three findings from the 2a-ii review, 2026-08-14**, all in `sessionManager.ts`.
The first was raised independently by both reviewers, which is the signal worth
recording — one of them can be wrong about intent, two agreeing about the same
five lines usually are not.

1. **Cancelling the context list reported an unreachable deployment.** The rule
   `cancellation.ts` states — on a failure, ask the token first, and if it was
   cancelled say nothing — was obeyed everywhere except `contextFor`, which runs
   its own progress and handles the result *after* `withProgress` returns, where
   the token no longer exists. So that one arm called `report` unconditionally.
   The fix narrows `reportFailure` to take the boolean it actually needs rather
   than a token, and `contextFor` returns the cancellation flag alongside the
   result. Worth generalising: **a rule that depends on a value being in scope
   will be broken by the first caller whose scope differs.** The four call sites
   inside `open` never noticed because they all share one token by construction.
   Pinned by a test; the existing cancel test sets `context` on the profile and
   so never entered the branch, which is how it stayed green over a real bug.
2. **An orphaned doc comment.** Two comment blocks stacked above one
   declaration: TSDoc binds to the *next* declaration, so `ComputeConnection`'s
   documentation attached to nothing and the exported interface had none. Moved.
   Nothing catches this — not the compiler, not the linter, not `check:docs`.
3. **`disconnect` did not join an in-flight `connect`.** `connect` de-dupes
   itself, `disconnect` did not consult it, so a disconnect arriving mid-connect
   found an empty map, told the user there was no session, cleared a binding
   about to be rewritten, and left the session the connect then created. Both
   reviewers called it narrow because the palette `enablement` conditions are
   mutually exclusive — but `executeCommand` from a keybinding, another
   extension, or a second window ignores `enablement` entirely. Fixed by
   awaiting `this.connecting` (with the rejection swallowed, since a failed
   connect has already reported itself and is not disconnect's to re-raise).

**A second review round, 2026-08-15**, on the fixes above. One non-blocking nit —
`dispose` does not join an in-flight connect, unlike `disconnect` — was
**accepted rather than fixed**, and the file says why: it runs while the window
is closing, so the connect it would wait for only repopulates state about to be
discarded, and `dispose` is synchronous so there is nowhere VS Code would honour
the await. One blocking finding, the write-back naming the wrong profile, is
recorded with the manual-test findings above because it is the second half of one
story.

```bash
# ⛔ BARRIER: merge 2a-ii first.
# 2a-iii — one account, one command
git checkout -b phase-2a-iii-account-hint
git commit -m "fix(auth): connect as the active profile's account"
```

☐ **2a-iii punch list.** Five defects, every one of them found by using the
extension or by review, and **not one of them by the test suite** — which is the
argument for the manual procedure above, not an argument against the tests. They
are one slice because they are one file's worth of surface: #84 changes both
`AuthProvider` method signatures, and the other four edit the same call paths.

**Do #84 first.** The rest are cheap once it lands and expensive if they land
first and have to be rewritten around it.

- ☑ **#84 — ask VS Code for the active profile's account, instead of refusing the
  wrong one.** `runConnect` calls `authSession(true)` with no hint, VS Code hands
  back whichever account it last used, and the manager then *refuses* because the
  session id (which **is** the profile id) does not match the active profile.
  Sean hit this the first time he had two profiles: "it tells me in the drop down
  that the other profile is the one selected, but when I try to connect it tells
  me I'm using the profile that is NOT selected."

  `AuthenticationGetSessionOptions.account` exists at our `^1.104.0` floor
  (`@types/vscode` `index.d.ts` ~17815) and is documented as being passed down to
  the provider "to be used for creating the correct session". Our `getSessions()`
  and `createSession()` take **no arguments at all**, so today there is nothing
  for VS Code to pass it *to* — both signatures have to widen before the caller
  can ask for anything.

  Honour it on **both** paths, and say so in a test each: the interactive
  `createIfNone` connect, and the silent per-request refresh
  (`getSession(…, { silent: true })`) that `ComputeClientConfig.token` calls on
  every single request. Missing the silent one would leave the borrowed token
  drifting back to the wrong account under a long-lived session, which is worse
  than the bug being fixed because nothing would report it.

  The refusal in `sessionManager.ts` **stays**. It becomes unreachable in normal
  use rather than dead: it is the assertion that the hint was honoured, and an
  extension host that ignores an option is exactly the kind of thing a guard is
  for. What comes out is the *documentation* of it as a limitation — the
  `::: warning A second profile is not usable yet` block in `docs/connecting.md`,
  the **Known limitation** paragraph in `CHANGELOG.md`, and the troubleshooting
  entry that tells the user to switch profile as a workaround. Removing those is
  part of this item, not a follow-up.

  **Done 2026-08-15.** The hint is derived rather than stored: `runConnect` reads
  `vscode.authentication.getAccounts()` once and matches the active profile's
  deployment against it with `accountForEndpoint()` in `src/auth/identity.ts`,
  which lives beside the rule that *builds* an account id so both halves of the
  format stay in one module. A unique match becomes `{ kind: "known", account }`;
  **ambiguity degrades to no hint**, because two people signed in to one
  deployment is exactly the case where guessing skips past the only UI that would
  have told the user. No account at all is `{ kind: "new" }` —
  `forceNewSession`, not `createIfNone`, because it covers both "nothing is
  signed in" (the API documents them as identical there) and "accounts exist for
  *other* deployments that a picker would otherwise offer". The three arms are a
  union rather than two booleans because `createIfNone` and `silent` together are
  rejected at runtime.

  **Corrected 2026-08-15 by the manual run below.** `forceNewSession` skips the
  *picker* and nothing else. It does not stop VS Code substituting an account of
  its own choosing, which it does whenever we name none — see #137. The paragraph
  above is left as written because the reasoning it records is still why this arm
  uses `forceNewSession`; it was simply incomplete, and being incomplete cost a
  live sign-in to the wrong deployment.

  The silent path carries `auth.account` — **not** the hint — into `clientFor()`,
  so the per-request refresh names whoever was actually signed in, including
  after an interactive flow where there was no hint to begin with, and does it
  without a second `getAccounts` round trip.

  On the provider side the order is **resolve everything, publish everything,
  return the subset**: `getSessions` filters only what it returns, because
  publishing a filtered list would fire a change event announcing every other
  session as removed and flip `pythonOnViya.authorized` off. `createSession`
  signs in to the profile the named account belongs to rather than the active
  one, and refuses — before opening a browser — an account no profile uses.
- ☑ **#134 — Sign In connects.** Sean's design call, 2026-08-15: "I want the
  design to be that it should automatically connect once you sign in. It's
  pointless and a waste of time to make the user do two things. What other point
  is there of signing in if not to connect to a session?"

  Applies to **our** *Python on Viya: Sign In* command only. The Accounts-menu
  entry must **not** connect: it is VS Code's own UI, it is polled, it has no
  profile in hand, and starting a SAS process from a menu the user opened to read
  is the opposite of the ADR-0002 posture. Depends on #84 for the same reason the
  connect does — signing in has to know which account it just became.

  `docs/signing-in.md` and `docs/connecting.md` both currently describe two steps.
  Connect stays a command; what changes is that you rarely need it.

  **Done 2026-08-15.** `registerComputeCommands` now *returns* a connect closure —
  `sessions.connect()` followed by the `pythonOnViya.connected` sync, showing no
  message — and `src/extension.ts` builds compute first so it can hand that
  closure to `registerAuthCommands`. The dependency points auth → compute in
  exactly one place, and it is a structural `ConnectAfterSignIn` declared inside
  `src/auth/commands.ts` (`() => Promise<{ profileName } | undefined>`) rather
  than an import, so the two modules do not become mutually dependent to describe
  one string.

  The connect lives in the **command**, not in `createSession`, and that is the
  whole mechanism by which the Accounts menu does not connect: both routes share
  the provider, so anything put there would fire on a polled menu. Nothing has to
  tell the two callers apart after the fact, and the test that would prove it is
  the absence of a dependency — `AuthProvider` has no import, port or stub that
  reaches a compute session.

  One notification per command, either `Signed in as {0}, and connected using
  profile "{1}".` or, when the connect did not happen, `Signed in to SAS Viya as
  {0}.` — the manager has already reported its own failure and stays silent on a
  cancellation, so the only fact left to carry is that the sign-in itself worked
  and a second attempt is not what is needed. A failed sign-in does not connect
  at all: there would be no token, so it would open a browser for a second
  sign-in nobody asked for, on top of an error about the first.

  `signIn` and `signOut` are now exported and take a deps object with `inform` /
  `report` ports defaulting to the real `vscode.window` calls. That was forced:
  the palette ids belong to the activated extension, so a test cannot register a
  second copy of the handler to drive it, and a handler whose only observable
  effect is a notification is untestable until the notification is a port. It
  also sets up #131. Four tests in `test/integration/auth/commands.test.ts` cover
  both messages, the no-profile arm and the failed-sign-in arm.

  Docs updated as anticipated, though the emphasis landed the other way round:
  the two commands now *meet in the middle* rather than one becoming rare, and
  `docs/signing-in.md` gained a paragraph on why the Accounts menu is the one
  place they differ. `docs/connecting.md` reframes Connect as the command for
  *re*connecting.
- ☑ **#133 — one unreachable profile must not stall the Accounts menu.**
  `getSessions()` loops every profile **serially**, calling `resolve()` on each.
  Sean's first deployment shuts down at weekends, so one dead endpoint costs a
  full connect timeout before any later profile resolves — and that call is what
  VS Code polls to draw the menu. Resolve them concurrently, and bound the wait
  so a hung deployment degrades to "no session for that profile" rather than to a
  spinner. A timeout here is not a policy about the deployment; it is a policy
  about a UI poll.

  **Done 2026-08-15.** Five decisions, in the order they had to be made.

  **Concurrent, in the caller's order.** `Promise.all` over the profiles, with
  the input order preserved, because `Promise.all` resolves in input order and
  the alternative — appending each session as it lands — would reorder the
  Accounts menu by whichever deployment answered fastest. A menu that shuffles
  between polls is worse than a slow one.

  **`RESOLVE_BUDGET_MS = 10_000`, and it is not a setting.** The two real
  timeouts underneath are `tokenEndpoint.DEFAULT_TIMEOUT_MS = 30_000` and
  `identity.DEFAULT_TIMEOUT_MS = 15_000`, so the serial worst case per dead
  profile was forty-five seconds. Ten is a third of the first one and roughly the
  point at which a menu reads as broken. Exposing it would invite someone to
  raise it, which is the wrong direction: the fix for a slow deployment is not a
  longer stall in a menu the editor polls.

  **The budget bounds the answer, not the work.** The renewal is not cancelled
  when the budget expires; it keeps running and warms `this.live`, so the next
  poll — seconds later — serves it from memory. Nothing is wasted and the account
  appears on its own. Deliberately rejected: re-publishing when the late renewal
  lands. It would fire a change event from a call that has already returned, race
  the `published` set, and on a deployment that is merely slow rather than dead
  it would publish on **every** poll.

  **An in-flight `resolving` map, keyed by profile id.** This is not an
  optimisation, it is forced by the line above: once a caller can walk away from
  a renewal, a poll every few seconds against a dead host opens a socket every
  few seconds and closes none. Sharing the in-flight promise means the second
  caller waits on the first request. A `.finally` clears the entry.

  **`BUDGET_SPENT` as a `Symbol`, not `undefined`.** `undefined` is already a
  real answer from `resolve()` — "there is nothing stored for this profile" — so
  collapsing the two would log a slow-deployment debug line for every profile
  that has simply never been signed in to, on every poll.

  **The account named is the one worth waiting for.** `getSessions(scopes,
  options)` already receives `options.account` since #84, and it separates the
  two caller kinds exactly: a polled menu names nothing and is bounded; the
  compute connect names an account and is waited for without limit, because it
  would rather be slow than be told there is no session when there is. No new
  plumbing — `getSessions` resolves the account to a profile id and hands it to
  `allSessions` as the one exempt profile. Honest residual: a connect with no
  hint to offer, which is a window with two profiles pointing at one deployment,
  is bounded like a poll.

  One pre-existing defect fell out on the way. `resolveOnce` now `catch`es, so a
  rejected renewal — one unreadable keychain entry — no longer fails the whole
  `Promise.all` and empties the menu of every other account. It logs
  `Could not read the sign-in for {0}: {1}` at warn.

  Four integration tests in `test/integration/auth/auth-provider.test.ts` under
  "when one deployment does not answer", driven by a transport that holds a
  matching URL open until released, with `resolveBudgetMs` injected at 50ms. The
  harness needed one non-obvious thing: a **sticky** `released` flag, because a
  renewal is two requests — the token then the identity — and the second is only
  issued once the first answers, so a non-sticky release would re-hold the
  identity call and hang the test.
- ☑ **#131 — report a cancelled sign-in as a cancellation, not a failure.**
  `browserFlow.ts:163` already knows: it logs "Sign-in was cancelled." at `info`
  and the comment says "Neither is an error and neither gets a dialog." Then
  `createSession` collapses the `undefined` into
  `throw new Error("Signing in to SAS Viya did not complete.")` and
  `reportSignInFailure` (`auth/commands.ts:131`) turns that into `[error]` plus an
  error dialog. **Same family as #127**: the fact is known at the bottom of the
  stack and dropped at the boundary.

  The constraint that makes this awkward, and the reason it is on a list rather
  than already done: an error thrown from `createSession` reaches a caller that
  went through `vscode.authentication.getSession`, which is an **RPC hop**. The
  error is serialised, so `instanceof` does **not** survive it and our
  exported-error-types rule has no purchase across that boundary. The compute
  path needs its own answer — most likely the command layer deciding before it
  ever throws, rather than the caller classifying afterwards.

  **Done 2026-08-15.** The guess above was wrong in a useful way: the command
  layer *cannot* decide before it throws, because on the compute path the command
  layer is on the far side of the hop and never sees the flow at all. So both
  callers classify afterwards, and the work went into making the classification
  survive the crossing.

  **The marker is the `name`, not the class.** `vscode.authentication.getSession`
  serialises a rejection and rebuilds it as a plain `Error` carrying `name`,
  `message` and `stack`. `instanceof` is therefore false on the far side even
  though the near side threw the real class. `name` is one of the three fields
  that do survive, so `isSignInCancelled` reads that and nothing else. One
  predicate for both callers, so the near side cannot silently keep working while
  the far side rots.

  **`Error` subclasses do not set `name`.** It inherits as `"Error"` after
  compilation, so the constructor assigns it explicitly. Without that line the
  marker is wrong *everywhere*, including where nothing was serialised — which is
  the sort of thing that looks like an RPC problem for an afternoon.

  **A thrown error, not a `{ok:false, reason}` union.** The tempting shape is for
  `signInWithBrowser` to return its reason, since it already returns `undefined`
  for a failure. Rejected: the fact has to reach `createSession`, which must
  reject either way, and a returned reason is a value an intermediate frame can
  drop by writing `if (tokens === undefined) return` — which is exactly how this
  defect happened the first time. A throw cannot be dropped by accident.

  **Its own module, `src/auth/cancellation.ts`.** Forced, not chosen:
  `browserFlow.ts` throws it and `authProvider.ts` catches it, and authProvider
  already imports browserFlow, so putting the class in either one makes a cycle.
  The module imports nothing, which puts it *inside* the c8 denominator (ADR-0009)
  — the one place in this slice where a unit test can reach the logic directly.

  **Two cancellation sources, not one.** The browser and paste-box arm is in
  `browserFlow.ts`; the masked client-secret prompt is in `authProvider.ts` and
  the flow cannot see it, because dismissing it happens before the browser opens.
  Both now throw the same error.

  **What each caller does with it.** `commands.ts` returns without a dialog and
  without an information message — a toast confirming that nothing happened is
  still a toast, and the log line was already written where the cancellation
  happened. `sessionManager.ts` turns it back into the `undefined` that every
  other "no session" answer already uses, which is what stops it surfacing as
  *Running the contributed command … failed*. Everything that is **not** a
  cancellation still propagates there; reporting an unreachable deployment as an
  ended sign-in is #130's, and swallowing it here would close #130 by hiding it.

  Seven unit tests in `test/unit/auth-cancellation.test.ts` — including the
  failure direction, which is the quieter defect: a deployment that refused would
  show nothing at all. Integration tests cover the dismissed box in
  `browser-flow.test.ts` (plus a new "does not read a refused exchange as a
  cancellation"), the command in `commands.test.ts` (including a hand-built
  post-hop error), and the connect in `session-manager.test.ts`.

  **Recorded risk.** The RPC hop is not exercised for real anywhere. Driving it
  needs the *activated* provider, whose browser ports no test can reach, so it
  would open a real browser and block. `afterAnRpcHop` in the unit test states the
  shape instead. If the editor ever changes what it copies, that test keeps
  passing while the behaviour breaks — and the failure would be the loud
  direction, a dialog for a cancellation, which is what we started with.
- ☑ **#132 — say why a stored session was not used, at debug.** `resolve()` has
  three branches that return `undefined` and one of them says nothing at all,
  which is right for an Accounts-menu poll and wrong for the first reload after a
  sign-in: it is why step 4 of the manual procedure could not be read off the log.
  Debug level, no dialog, and it must not name a token, a refresh token or a
  correlation id.

  **Done 2026-08-15.** The silent branch turned out to be two facts wearing one
  coat, and separating them is most of the value.

  **Nothing stored and nothing in memory** is the ordinary state — a fresh
  window, a sign-out, a profile nobody has used — and it goes to **debug**,
  unlocalised, like every other debug line in this codebase. The Accounts menu
  polls `getSessions` for every profile it can see, so at info a window with one
  unused profile writes this line for as long as it stays open.

  **Nothing stored but something in memory** is the interesting one, and it goes
  to **info**, which is a deliberate deviation from the "debug level" written
  above. It means the deployment issued no refresh token, so the session could
  only ever last as long as its access token and the account has just left the
  Accounts menu on its own — which from the outside is indistinguishable from a
  defect. Two things earn the level: it fires **once**, because the same branch
  drops the expired session and every later poll takes the quiet one, and a
  `LogOutputChannel` shows info by default, so a line the user has to raise the
  log level to find is a line that is not there when they go looking. `info` on a
  log channel is not a notification; nothing pops up.

  **The malformed case was already covered** one layer down: `SessionStore.read`
  discards an entry it cannot parse and says so at warn, so what reaches this
  branch is genuine absence. Worth knowing before adding a third message here.

  Neither line names a token, a refresh token or a correlation id — both name the
  endpoint, which the renewal-failure line beside them already does.

  **Testing needed a new helper, and the wording is now under test.**
  `recordingLog` in `test/helpers/auth-host.ts` delegates to the real cached
  channel and keeps what was written, so a test can assert on level and text.
  Almost nothing else in the suite should use it — asserting on wording turns
  every rewording into a failing test — but here the log line *is* the whole
  deliverable, and both branches return no session, so nothing else observable
  tells them apart. It uses `Object.create` over the real channel rather than a
  copy, which keeps `name`, `logLevel` and `dispose` real and dodges the
  disposal trap in `testLogChannel`'s doc comment: the wrapper is new per
  harness, the channel underneath is the cached one.

  Two integration tests in `test/integration/auth/auth-provider.test.ts`, on a
  new `refreshToken: false` harness option — a grant that succeeds and issues no
  refresh token. The second asserts the info line fires exactly once and that the
  next read falls back to the debug one, which is the claim the level rests on.

- ☑ **#137 — stop VS Code's remembered account overriding the active profile.**
  A sixth defect, found by the manual run below on 2026-08-15, and a defect *in*
  #84 rather than one it left behind: with two profiles on two deployments,
  switching to the second and running **Connect** opened the browser on the
  first deployment's SASLogon.

  `getSession` does not pass our options to our own provider unchanged.
  VS Code's `doGetSession`
  (`vs/workbench/api/browser/mainThreadAuthentication.ts`, read at
  `release/1.104`) computes
  `accountToCreate = options.account ?? matchingAccountPreferenceSession?.account`
  and hands that to `createSession`. Naming no account does not leave the choice
  open — it delegates it to the *account preference*, which the host stored
  under `updateAccountPreference` at the end of the last interactive
  `getSession` that succeeded. In the run below that was the reload-and-Connect
  on the first profile. `createSession` then honours `options.account` above the
  active profile, which it does on purpose so the Accounts menu's *sign in
  again* row acts on the row it was clicked on, and it has no way to tell a
  preference the host recalled from an account the user chose.

  Fixed by adding `clearSessionPreference: true` to the `new` arm.
  `doGetSession` calls `removeAccountPreference` *before* it reads the
  preference, so `accountToCreate` falls back to `undefined` and the provider
  decides from the active profile. Not added to `known`, which already names an
  account and never consults the preference, and deliberately not to `silent`,
  which the Accounts menu polls — clearing is a write, and a read that mutates
  on every poll is not a read.

  **Why no test caught it, which is the more useful half.** The manager's
  `deps.authSession` port is injected one frame *above* the mapping from request
  to options, so every existing test could assert which `AuthRequest` was chosen
  and none could assert what it became. The mapping now lives in
  `src/auth/sessionRequest.ts` — pure, `import type * as vscode`, therefore
  inside the coverage denominator by ADR-0009's mechanical rule — with
  `test/unit/auth-session-request.test.ts` stating each arm as a whole-object
  literal. `AuthRequest` moved there with it. **The lesson generalises: an
  injected seam decides what is testable, and a seam above the decision makes
  the decision invisible.**

  Two related host behaviours worth knowing before touching this again, both
  read out of the same function. `isAccessAllowed`, `updateAllowedExtensions`
  and `_getAccountPreference` all key on **`account.label`**, never on
  `account.id` — our label is the user's display name, so one person signed in
  to two deployments is one account as far as the host's bookkeeping goes. And
  after `createSession` returns, a `do…while` compares the requested and
  returned labels and shows a modal **Incorrect account detected** if they
  differ, so a provider that ignores the hint gets a dialog rather than silence.

**Testing shape.** `authProvider.ts` and `commands.ts` are host-only and outside
the c8 denominator (ADR-0009), so the first five land as **integration** tests —
which `npm run verify` does not run. Hand over `npm run test:integration` as well,
every time. The first five will not move the ratchet; do not raise it hopefully.
**#137 is the exception**: it adds a pure module and a unit suite, so it does add
to the denominator and the measured numbers may rise. Floor the thresholds to
what the run reports rather than to what looks tidy.

**Measured 2026-08-15, and the ratchet does not move.** `sessionRequest.ts` scores
100 on all four counters, and the aggregate went 89.65 → **89.79** statements,
88.77 → **88.83** functions, 94.31 → **94.34** branches. Every one of those rounds
down to the threshold already in `.c8rc.json` (89/89/88/94), so it stays as it is.
That is the ratchet working, not the ratchet being skipped: a fully covered module
of this size moves an aggregate by a tenth of a point, and testing.md's *round
down further than feels necessary* exists precisely so a tenth of a point on one
platform is not a red build on another.

☑ **Done; passed 2026-08-16.** The five defects above were all found by hand and
four of them are only observable by hand, so this was the gate on the slice
rather than a nicety. It replaced the 2a-ii procedure rather than extending it.
Closed across two runs — 2026-08-15 for steps 1–5 and the reload, 2026-08-16 for
step 6 in full plus a re-proof of the cold start and the context write-back on
the post-#137 build. Three findings came out of the second run and none of them
block the slice: #145, #146, #147, all recorded below.

**Run 2026-08-15, steps 1–5 passed and step 6 failed.** Recorded here rather than
in a commit message because the next reader needs the outcome next to the steps
that produced it. Steps 1 through 5 behaved exactly as written, including #134's
single command from cold, the context write-back into `settings.json` — which
this run **confirms**, closing the item 2a-ii left as *unconfirmed rather than
failed* — and #132's `Reconnected to the SAS Viya session for this folder.` after
a reload. Step 6 opened the browser on the **first** profile's deployment after
switching to the second, which is #137 above; the run stopped there and resumes
from step 6 once the fix is in. Two things the failure incidentally proved: the
refusal guard would have caught it, since it only stayed quiet because the
sign-in was cancelled before completing, and **Sign In** is unaffected, because
that command calls the provider directly and never gives the host the chance to
substitute anything.

**Run 2026-08-16: step 6 passes in full, including the back half.** Run against
`da6ccb0` with two **working** deployments — stronger than the "second endpoint
that does not have to work" this section asks for, because the second sign-in
actually completed. Connect on profile 1 reused stored credentials and started a
session; switching to profile 2 and connecting opened the browser on **profile
2's** deployment and signed in there. Both expected dialogs appeared and neither
was the finding: the host's *wants you to sign in again* modal, then the browser
consent. No **Incorrect account detected**, so #137 has not regressed.

The back half — the one the 2026-08-15 run never reached — passed as written.
Switching back to profile 1 left **Connect** absent from the Command Palette and
**Disconnect** present, which is this file's own statement of "the session is
still held". Profile 1's session survived the entire excursion to profile 2. That
answers **#141**, which is now closed on this evidence rather than on a fresh
test.

Two findings came out of it, neither in step 6:

- **#146 — the Accounts menu listed one row, not two**, for two signed-in
  deployments. `accountId(endpoint, userId)` keys on the deployment, so the ids
  differ and the obvious cause is ruled out. Either VS Code groups the menu by
  `account.label` — which `accountLabel()` derives from the person, identical on
  both deployments — or the resolve budget dropped one. The first would mean
  signing out of that row signs you out of both, so settle it before #138.
- **#147 — the row reads "Sean Ford (SAS Viya)"**, which does not say which
  extension owns it. The provider *id* was deliberately not `sas`; the label was
  left as the thing connected to rather than the thing connecting.

And one non-finding worth writing down so it is not re-reported: **Connect being
absent is correct** when the active profile already holds a session, but an
absent command is the only signal the user gets, and it reads as breakage even to
the person who wrote this procedure. That is **#145**, a discoverability defect,
not an enablement one.

**Steps 1–5, re-checked 2026-08-16 against the post-#137 build.** They had passed
on 2026-08-15 against the *pre-fix* build, and #137 changed how `runConnect` asks
for a session — the path all five take — so passing once did not carry over.
Re-confirmed by hand: profiles deleted and re-added **from scratch**, then signed
in and connected repeatedly, with `settings.json` populated each time with the
endpoint, the compute context id and its name. That is the cold start and the
context write-back, both proved on the build being shipped rather than the one
before it.

**The reload is confirmed too**, on both runs: **Developer: Reload Window**
followed by `Reconnected to the SAS Viya session for this folder.` in the log.
That is **ADR-0012** working — the session id held in `workspaceState`, and a
reloaded window reclaiming the *same* Viya session rather than starting a second
one. Worth naming separately because it is the only check in this slice whose
failure is invisible without reading the log: a fresh session looks identical to
a reclaimed one from the outside, except that everything the user defined in it
is gone.

Unlike the cold start, this one did **not** need re-proving after #137. #137
changed how `runConnect` asks for a session — the account hint and
`clearSessionPreference`. The reload path does not go through that: it reads the
id out of `workspaceState` and re-attaches. Recorded because the reflex of
"#137 landed, so re-run everything" is right about the connect path and wrong
here, and the distinction is what stops a future re-check being busywork.

Every expected line below is quoted **exactly** as the code writes it, and each
is marked either **notification** (a toast in the bottom right) or **log** (a
line in the Output panel). If what you see differs from what is quoted, that is
a finding even when it looks like the same thing said differently — a message
that has drifted from the source is how the next reader is misled.

**What you need.** One working deployment, and a *second endpoint that does not
have to work*. Step 6 is the one this slice exists for and it needs two
profiles pointing at two **different** addresses; whether the second one answers
is beside the point, because what is being checked is which account the editor
is asked for. A made-up host such as `https://viya2.example.com` is enough.

**Setting up.** Open `sas-py-vscode` in VS Code and press `F5`. That runs the
*Run Extension* launch configuration, which builds first and then opens a second
window titled **[Extension Development Host]**. **Do not use *Run Extension
(untrusted workspace)*** — its `--disable-workspace-trust` flag turns the trust
feature off, which trusts everything, so it does the opposite of its name. It is
on the unfiled list.

In the dev host, `File ▸ Open Folder` and open a scratch folder — any folder,
but it must be one, because the session binding lives in `workspaceState` and
there is none without a folder. Click **Yes, I trust the authors** when asked.

**Every command below is run the same way**: press `Ctrl+Shift+P`, type the
title exactly as it is written in bold, and press Enter. They all sit under a
**Python on Viya** category, so typing `Python on Viya` lists every one of them.
This paragraph is here because its absence is what made the first run of the
2a-ii procedure fail.

**A command that is not available is *missing*, not greyed.** Several steps below
check the Command Palette, and this is how to read them. Every command in
`package.json` controls its availability through `enablement` alone — there are
no `menus.commandPalette` entries — and VS Code answers a false `enablement` by
**leaving the command out of the palette entirely**. So "must not be available"
means you type the title and *nothing matches*. Confirmed by the 2026-08-15 run,
where Restricted Mode removed **Sign In** and **Sign Out** from the list rather
than dimming them. Earlier versions of this procedure said "greyed out", which
made a correct result look like a broken build.

**Turn the log up before anything else.** Run **Python on Viya: Show Log** to
open the Output panel on our channel. Then run **Developer: Set Log Level…**,
choose **Python on Viya** from the first list, and **Debug** from the second.
Several lines below are written at `debug` and are invisible at the default
level — including the one step 4 exists to read.

1. **Start from nothing.** If any profile already exists from an earlier run,
   run **Python on Viya: Sign Out**, then **Python on Viya: Delete Connection
   Profile** for each, confirming with **Delete**. The point is that step 2
   begins signed out, because "signed in already" quietly skips the half of
   this procedure that matters. The status bar at the bottom should show a
   server icon and the words **No profile**.

2. **Add a profile, and leave the context empty.** **Python on Viya: Add
   Connection Profile**. Give it a name at *Profile name*; your endpoint at *SAS
   Viya endpoint*; then press Enter on *Compute context (optional — you can
   choose one later)* **without typing anything**, which is what puts the
   context picker on the path in step 3; press Enter on *OAuth client ID
   (optional — leave empty on Viya 4 2022.11 and later)* as well, so the
   built-in `vscode` client is used and no client-secret prompt appears.

   Log: `Added connection profile "<name>".` The status bar now shows the
   profile name.

3. **One command from cold reaches a session (#134).** Run **Python on Viya:
   Sign In** — *not* Connect. In order, expect: your browser opening on the
   deployment's login page; a **Sign in to SAS Viya** input box at the top of
   the editor; a short code displayed by Viya after you approve the consent
   page, which you paste into that box; then a *Reading compute contexts…*
   progress, a quick pick titled *Select a compute context for this connection
   profile*, and a *Connecting to SAS Viya…* progress.

   Notification: `Signed in as <your name>, and connected using profile
   "<name>".` — **one** notification naming both halves. Two separate messages,
   or a sign-in that stops without connecting, is a finding.

   Log, in order: `Signed in to <endpoint>.` then `Started a SAS Viya session on
   compute context "<what you picked>".`

4. **The context write-back landed.** This is the step recorded as *unconfirmed
   rather than failed* after the 2a-ii run, so confirm it properly. Open the dev
   host's `settings.json` (**Preferences: Open User Settings (JSON)**) and find
   `pythonOnViya.connectionProfiles` → your profile → `context`. It must now
   hold exactly what you picked in step 3. User settings is the right file for a
   fresh folder because the store writes to `Global` unless the setting already
   exists at workspace scope; if you have put profiles in a workspace file
   before, look there instead.

   Two things make this worth its own step. It edits the user's settings as a
   side effect of connecting, which is the kind of thing that should never be
   assumed to have worked; and the write happens **after** the session starts,
   so a context that fails to start a session must *not* be written. If you want
   the negative half, `Ctrl+Z` is not enough — clear the field by hand in
   `settings.json` and see step 9.

5. **Reload, and read the reattach off the log (#132).** Run **Developer: Reload
   Window**. Wait for the window to come back, run **Python on Viya: Show Log**
   again, then **Python on Viya: Connect to SAS Viya**.

   Log: `Reconnected to the SAS Viya session for this folder.` It must **not**
   say `Started a SAS Viya session` — a second *Started* means the stored id was
   not used and a SAS process has been orphaned. No context picker this time
   either, because step 4 wrote the answer down.

   Notification: `Connected to SAS Viya using profile "<name>".`

   Now read what is around it, which is what #132 changed. At `debug` you should
   see `no stored sign-in for <endpoint>` **only** for profiles you have never
   signed in to — not for this one. And the line
   `The sign-in for <endpoint> has expired, and no stored sign-in was kept to
   renew it from. Sign in again to continue.` should **not** appear at all: it
   means the deployment issued no refresh token, and this deployment demonstrably
   does, because the reload above restored the session. If you do see it, that is
   a finding worth the whole trip.

6. **Two profiles, two deployments — the defect this slice is named for (#84).**
   Add a second profile with **Python on Viya: Add Connection Profile**, giving
   it a different name and the second endpoint. Leave context and client ID
   empty as before. Then **Python on Viya: Switch Connection Profile** and pick
   the second one; the quick pick marks the current one *Currently in use*, and
   the status bar should change to the new name.

   Now run **Python on Viya: Connect to SAS Viya**. The correct behaviour is
   that **your browser opens on the second deployment**, asking you to sign in
   to it. Read the **host in the address bar**, not the page — which deployment
   was asked for is the entire assertion of this step, and a login page from the
   wrong deployment looks exactly like a login page from the right one. What
   must **not** happen is the notification
   `The account chosen is not the one "<name>" uses. Run Python on Viya: Switch
   Connection Profile to change which deployment this folder uses.` — that is
   the old defect verbatim, advice to run the command you have just run, and
   seeing it means the account hint was not honoured.

   Two dialogs to expect, of which only one is a finding. **Before** the browser
   opens, VS Code — not this extension — puts up a modal reading roughly *The
   extension 'Python on Viya' wants you to sign in again using SAS Viya*, with a
   **Sign In** button. Press it. That is the host confirming an extension may
   start a fresh sign-in while a session is already live; it appears on this path
   whatever deployment is about to be asked for, and the wording is VS Code's and
   shifts between releases, so it is not evidence either way. A dialog headed
   **Incorrect account detected**, on the other hand, offering to continue with
   an account you did not pick, *is* a finding: it can only be reached when the
   host has filled in a remembered account behind our back, which the request
   this slice sends now explicitly clears (#137). Seeing it means the fix has
   regressed.

   With a made-up endpoint the browser opens on a page that does not load, and
   the **Sign in to SAS Viya** box opens beside it and waits — indefinitely, and
   on purpose, because it has `ignoreFocusOut` set. **Press `Escape` on it.**
   The connect then ends silently with `Sign-in was cancelled.` at `info`. Do
   not paste anything into the box: a code sent to a deployment that is not
   there produces a real failure and an error toast, which tells you nothing
   this step is asking about. The check has already passed by the time the
   browser opens, because what is being checked is which deployment it asked
   about.

   Now **Switch Connection Profile** back to the first one, and look at the
   Command Palette rather than running anything: **Python on Viya: Connect to
   SAS Viya** must be **absent from the list**, and **Disconnect from SAS Viya**
   must be there. That is the same fact as "the session is still held", read off the
   `pythonOnViya.connected` enablement instead of off the log — profile 1's
   session survived the whole excursion to profile 2, which is what one live
   session per profile means and what upstream's process-global singleton cannot
   do. (There is no way to make the manager *say* it returned a held connection:
   it returns before it logs anything, which is the point.)

   Note the honest gap while you are here: two profiles pointing at the **same**
   deployment share one account id, so the hint cannot separate them and the
   guard above may still fire. That is the known narrow case, written up under
   #84 — not a new finding.

7. **A profile that is down must not stall the menu (#133).** With both profiles
   present, open the **Accounts** menu — the person icon at the bottom of the
   Activity Bar, next to the gear. The account for the working deployment must
   be listed, promptly, and it must be listed *whatever* the second profile is
   doing.

   The ten-second budget itself is **not** testable here, and it is worth
   knowing why rather than trying and recording a false pass. A profile with no
   stored sign-in never reaches the network at all — `resolve` takes the
   `no stored sign-in for …` branch and returns — so a second profile you have
   never signed in to costs nothing no matter what its endpoint does. To spend
   the budget you would need a *stored* sign-in for a deployment that hangs,
   which means signing in to it first, which means it working. That arm is
   covered by an integration test on an injected `resolveBudgetMs`, and the debug
   line it writes is
   `renewing the sign-in for <endpoint> is taking longer than 10000ms; answering
   without it` if you ever do see it in the wild.

8. **Cancelling says nothing (#131).** Get back to a **cold state** first, which
   means this window has nothing left to reuse for the active profile: **no
   compute session held** for it, and **no stored token** for its deployment.
   Only then does **Sign In** actually have to go and fetch a token, and only
   then is there a sign-in to cancel. Make sure the working profile — the one
   with the real endpoint, which step 6 left active — is the active one, then run
   both of: **Python on Viya: Disconnect from SAS Viya**, then **Python on Viya:
   Sign Out**. Both are needed, and the order is not cosmetic. Signing out
   does not end the compute session, and a connect that finds one still held in
   this window returns it without asking for a token — so with the session still
   live there would be no sign-in to cancel and the step would pass by doing
   nothing. Sign out *first* and it is Disconnect that breaks instead: the
   `DELETE` needs a token, cannot get one, and the log says `Ending the SAS Viya
   session did not complete: …` at `warn` with no `Ended the SAS Viya session.`
   line, leaving a session alive on the server. That is correct behaviour being
   asked an impossible question, not a defect — but it looks exactly like one.

   Read the cold state off the UI rather than assuming it. Open the Command
   Palette: **Connect to SAS Viya** must be listed and **Disconnect from SAS
   Viya** must not appear at all, which is `pythonOnViya.connected` saying no
   session is held. Then open the **Accounts** menu and confirm your Viya account
   is no longer listed, which is the token half. If Disconnect is still there you
   are not cold, and everything below will pass without testing anything.

   Now run **Python on Viya: Sign In**, and when the **Sign in to SAS Viya** box
   appears, press `Escape`.

   Expected: **no dialog of any kind**, and in the log `Sign-in was cancelled.`
   at `info`. What this replaces is `Signing in to SAS Viya failed` at `error`
   plus a red toast, which is what the first manual run saw.

   Repeat for the other entry point: run **Python on Viya: Connect to SAS Viya**
   while signed out and press `Escape` on the same box. Again nothing should
   appear — no error, and no *Running the contributed command … failed*.

   Then sign in properly with **Python on Viya: Sign In** and let it finish. You
   need a live session for step 9, and the third cancellation check lives there
   rather than here because a connect that returns the session already held in
   this window never draws a progress notification to cancel.

9. **Disconnect, and prove the binding was cleared.** Run **Python on Viya:
   Disconnect from SAS Viya**. There is deliberately **no** notification for
   this; the log says `Ended the SAS Viya session.` and that is all. Then check
   the palette: **Disconnect** has **gone from the list** and **Connect** is
   back, which is `pythonOnViya.connected` following the truth.

   Do **not** look for `There is no SAS Viya session to disconnect.` here. That
   message exists for callers the enablement cannot reach — a keybinding, a
   second window, another extension — and from the palette the command is not
   offered at all, so it never gets the chance. `sessionManager.ts` says as much
   where the race is handled.

   Then **Connect** once more. It must log `Started a SAS Viya session on compute
   context "…"` and **not** `Reconnected` — a *Reconnected* here would mean
   Disconnect dropped our reference and left the session running on the server.

   Now the remaining two cancellations, both of which must be silent. First:
   **Disconnect** again, then **Connect**, and press **Cancel** on the
   *Connecting to SAS Viya…* notification while it is up. Log: `Connecting to
   SAS Viya was cancelled.` at `info`, and **no** error dialog.

   Second, the arm review caught in 2a-ii (#127): delete the profile's
   `context` value in `settings.json` so the picker comes back, **Connect**, and
   press **Cancel** on the *Reading compute contexts…* progress instead. Same
   line, same silence. What must **not** appear is `Could not reach the SAS Viya
   compute service…` — that is what an aborted request looks like underneath,
   and reporting it to someone who pressed Cancel is the defect. Then
   **Connect** once more, pick a context, and let it finish, so the folder is
   left with a session for step 10.

10. **Trust.** Run **Workspaces: Manage Workspace Trust** and put the folder back
    into Restricted Mode. In the Command Palette, **Python on Viya: Sign In**
    and **Python on Viya: Sign Out** must **not be listed at all** — the refusal
    behind that gate is covered by an integration test, and what only a human can
    confirm is that the palette entry is gone rather than merely failing when
    run. The Accounts menu should show no **SAS Viya** account. Trust the folder
    again and the account comes back without a reload.

    Those two commands are the clean test and **Connect is not**: its enablement
    is `!pythonOnViya.connected` as well as `isWorkspaceTrusted`, and step 9
    deliberately left a session, so it would be missing either way and tells
    you nothing about trust. Profile management is meant to keep working without
    trust, so **Add Connection Profile** and **Switch Connection Profile** should
    both stay available — see ADR-0002.

**The death path, if you have the time.** Unchanged by this slice, and the one
step that cannot be hurried, so it is optional here rather than numbered above.
Note the time of a connect, reload the window, wait until **sixteen minutes**
past it — the idle reaper is 900 seconds from the session's last activity and
nothing touches it in between — then **Connect**. Expect, at `info`, `The
previous SAS Viya session has ended, so a new one will be started. Anything
defined in it is gone.` followed by a new `Started` line, and **no** error
dialog, because a session ending on its own schedule is ordinary.

**Optional cross-check from the Viya side.** The compute session id is never
logged on purpose, so find it by listing instead: with the `viya-api-probe`
skill and `creds.json`, `GET /compute/sessions` and look for the one whose `name`
is `python-on-viya`. Doing that either side of step 9 is the only way to see,
from outside the editor, that Disconnect really took the session down.

**Run 2026-08-16: one session for six creates.** Done immediately after step 9 and
written up as **finding 30**. Every `DELETE` landed, and the same listing turned
up a correction worth having — `applicationName` is `vscode` for our sessions,
which is the built-in client id and therefore SAS's extension's too, so finding
25's reclaim filter must not be copied as written.

**Two things to expect that are already filed.** #130 is open: a request whose
silent token refresh comes back empty is reported as `The SAS Viya sign-in for
this profile has ended.` rather than as the network failure it usually is. It
comes from the per-request token function, so it needs a connect that got past
authentication — a Disconnect/Connect cycle against a deployment that has since
become unreachable, not step 6, where `runConnect` returns before a client is
ever built. And #135 is open on a compute context whose `createSession` link
comes and goes; if a context you pick in step 3 fails to start a session, that
is the one, and the picker is now reachable again because the write-back happens
after success rather than before.

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

☐ **3d-i — contribute the run target, and let it decide whether we appear.**
[ADR-0011](docs/adr/0011-choosing-where-python-runs.md) settles the mechanism; this
is the punch list for executing it.

- The pure part first: parsing, validating and labelling a target, and the "what
  does this target imply" rules, in a module with **no `vscode` import**, so
  ADR-0009's denominator keeps it. Only the `workspaceState` read/write and the
  status bar render belong in the shell.
- `pythonOnViya.selectRunTarget` — one picker listing **Local Python** and every
  configured profile, because choosing a profile *is* choosing Viya. The existing
  `pythonOnViya.activeProfile` status bar item takes this as its command;
  `pythonOnViya.switchProfile` stays in the palette and keeps working.
- Publish `pythonOnViya.runTarget` as a context key and gate our `editor/title/run`
  and `editor/context` entries on
  `editorLangId == python && pythonOnViya.runTarget == viya && isWorkspaceTrusted`.
  With the target on Local we contribute **nothing** to the editor and launch no
  interpreter — Local is the absence of us, not a feature.
- Store the target in `workspaceState`, never in settings. A committed target is a
  repository deciding where a stranger's code runs, which is the shape ADR-0002
  already restricts the profile settings for. Carry ADR-0007's qualifier when you
  write the user-facing strings: `workspaceState` is keyed to the *workspace*, so
  two windows on the same folder share one target. Do not let a tooltip or a doc
  page promise per-window independence the store cannot deliver.
- Never move the target for the user. A run against Viya with no profile, no
  session or a dead token fails with *Sign in* / *Switch to Local*, and does not
  quietly run somewhere else. Every run names its target as the output channel's
  first line, so the record outlives the status bar's current state.
- **Confirm by hand, in the editor:** how VS Code presents two `editor/title/run`
  contributions — which becomes the primary button, and whether the last used is
  remembered. ADR-0011 asserts this from the contribution point's documented
  shape, not from observation. If our entry can become the primary click by
  accident, that is the rejected "claim the play button" design arriving through
  the back door, and the ADR needs revisiting rather than working around.
- Changelog, not just a diff: the status bar item's command **changes** from
  `pythonOnViya.switchProfile` to `pythonOnViya.selectRunTarget`. That is a visible
  change to a shipped affordance.
- Docs owe one line on the cost: a user who sets Local loses our editor entries and
  may not know why. The status bar names the target, the tooltip says what it
  implies, and the palette command never disappears.
- **No keybinding, and none chosen until the beta reports.** `F8` is "next problem
  in files", `F5` is debug, `ctrl+enter` is Jupyter's for `.py` cells, and
  upstream's `F8`/`F3` would override "next problem" for every Python file the
  user opens — including on days they are not using Viya at all. Document how to
  bind one by hand, and leave this bullet standing after 3d-i ships: it is the
  open item, and it closes when a default is picked or the decision is recorded
  as "none by default, deliberately".

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

> **Superseded 2026-08-16. E1–E5 below were never run and will not be.** Both
> reviewers were proved on real slice pull requests instead, which is strictly
> stronger evidence than a seeded smoke test: their findings became tasks #113,
> #115 and #127–#129. The steps are kept because the bootstrap detail underneath
> them — the Entra federated credential, the Claude GitHub App install, the
> AADSTS700213 note — is what you would need if the reviewers ever stop posting.
> Read this section as reference, not as outstanding work.

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

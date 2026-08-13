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
  them in the same pull request**. Vendored generated OpenAPI clients are excluded
  from the denominator. See `docs/dev/testing.md`.

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
number climb. **Exclude the vendored generated OpenAPI clients from the
denominator**, or the ratchet is trivially gamed.

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

☐ **Raise the coverage ratchet in the same pull request** — 1b-i is pure,
heavily-tested code, so the thresholds should move up noticeably rather than by a
rounding margin. Current floor is 55 / 55 / 63 / 86.

☐ **Comment the 3.5 path in the code**, not only in the plan: it is built from
SAS's documentation and has never been observed against a live 3.5 deployment,
because there isn't one to observe. Decision 9 was amended on 2026-08-13 to stop
calling that a pending pre-release check — nobody can clear it, and a blocker
nobody can clear is a line people learn to step over.

```bash
# ⛔ BARRIER: merge 1b-i first.
# 1b-ii — the VS Code shell
git checkout -b phase-1b-ii-auth-shell
git commit -m "feat(auth): add browser sign-in, dual code capture, and proxy support"
```

☐ **1b-ii punch list.** `env.asExternalUri` / `env.openExternal`,
`window.registerUriHandler`, `window.showInputBox`, and the race between the last
two. **Validate `state` on the URI-handler arm and drop any callback that does not
match.** Note in the code that the paste-box arm carries no `state` and therefore
cannot be protected the same way — that is an argument for narrowing the paste box
later, not for skipping the check where it works. Plus the undici `ProxyAgent`
dispatcher and token persistence through `SecretStorage`.

```bash
# ⛔ BARRIER: merge 1b-ii first.
# 1c — AuthenticationProvider + secret storage
git checkout -b phase-1c-auth-provider
git commit -m "feat(auth): add AuthenticationProvider, secret storage, and CA helper"
```

☐ **After 1c**, verify manually against your Viya: sign in, reload the window,
confirm the session persists and the Accounts menu shows your identity.

### Phase 2 — Compute session and backend seam

```bash
# 2a — HATEOAS compute layer  ⚠ largest slice in the plan
git checkout -b phase-2a-compute-layer
git commit -m "feat(compute): add HATEOAS link layer, session creation, and reconnect"
```
☐ **Judgement call on 2a.** If the diff is too large to review well, split at the
generated-OpenAPI-client boundary: `phase-2a-i-generated-client` vendors the
generated client (a large but mechanical diff, reviewable by inspection), and
`phase-2a-ii-session-layer` adds the hand-written session/link layer. Decide when
you see the diff, not before.

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

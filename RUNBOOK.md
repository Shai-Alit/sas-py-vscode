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

☐ **A2.** Enable branch protection on `main`: require a PR before merging, disallow
direct pushes. **Defer "require status checks to pass" until after 0d-i-a merges** —
GitHub can't offer a check as required until it has reported at least once. Leave
the AI reviewers **out** of required checks; they are advisory and comment-only.

☐ **A3.** Set the repo to squash-merge only, with "delete branch on merge" on.
This is what keeps history linear and matches viyapy.

```bash
gh repo edit --enable-squash-merge --enable-merge-commit=false \
             --enable-rebase-merge=false --delete-branch-on-merge
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

☐ After 0d-i-a merges, **now** add the required status checks to branch
protection (deferred from A2 — they can only be selected once they've reported).
Require `verify`, `package`, and every leg of `test` you intend to depend on;
required checks are named per job, so adding an OS to the matrix later does not
add it to the requirement automatically. Leave the two AI reviewers advisory.

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

☐ **Settled 2026-08-12: the generated reference is committed**, so 0d-i-b must
also drop `docs/reference/` from `.gitignore`. See PRODUCTION_PLAN.md §4.1 —
the plan wanted CI to fail on a diff against a file `.gitignore` was keeping out
of the repo, and only one of those could survive.

```bash
# 0d-ii — security scanning
git checkout main && git pull --ff-only && git checkout -b phase-0d-ii-security-scanning
#   … 🤖 implement 0d-ii …
git add -A && git commit -m "ci: add dependency audit, secret scanning, and CodeQL"
git push -u origin phase-0d-ii-security-scanning
gh pr create --base main --head phase-0d-ii-security-scanning --fill
```

☐ Also check `AI-PR-REVIEWERS-RUNBOOK.md` into `docs/dev/` here, so a future
maintainer can re-derive the reviewer setup without hunting through the viyapy
project folder.

☐ **Triage the three advisories `npm ci` reported on 2026-08-12** (1 low, 1
moderate, 1 high) as part of designing the audit gate, rather than reflexively
running `npm audit fix --force`. All three are in **dev**-only dependencies, so
nothing reaches the VSIX — but they run on contributor machines and in CI, which
is not nothing. The likely family is `@vscode/vsce`, which drags in the archived
`keytar@7.9.0` and an old `glob@10.5.0`. Decide deliberately whether the gate
fails on `--omit=dev` only, or on everything with documented exceptions; a gate
that cries wolf about a packaging tool gets switched off within a month.

☐ Merge 0d-ii. Phase 0 is complete; start Phase 1.

### Phase 1 — Authentication

☐ **Before 1a**: settle open decision #5 — whether we share connection profiles
with the SAS extension when both are installed, or keep them separate
(*recommend separate for v1*). Also decide profile-schema versioning and setting
scope for multi-root workspaces; both are cheap now and painful later.

```bash
# 1a — connection profiles
git checkout -b phase-1a-connection-profiles
git commit -m "feat(auth): add Viya connection profiles and profile commands"

# ⛔ BARRIER: merge 1a first.
# 1b — OAuth2 + PKCE
git checkout -b phase-1b-oauth-pkce
git commit -m "feat(auth): add OAuth2 authorization code flow with PKCE"

# ⛔ BARRIER: merge 1b first.
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

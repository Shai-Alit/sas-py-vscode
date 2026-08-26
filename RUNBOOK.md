# sas-py-vscode — Maintainer Runbook (Punch List)

Companion to `PRODUCTION_PLAN.md`. The plan says *what and why*; this says
*which commands, in what order, and who runs them*.

> **Legend**
>
> - ☐ = a manual step **you** perform.
> - ☑ = that step is done, and the box is the record of it. So an unticked ☐
>   above finished work reads as *unrecorded* rather than as *not done* — which
>   is why a punch-list header is ticked once its items are, and why leaving one
>   open costs something to anyone scanning for what is outstanding.
> - 🤖 = prepared for you in the working copy — no action from you until the ☐
>   that follows.
> - **(not run)** = a step that was written and then overtaken by events before
>   anyone performed it. The procedure is kept, because the detail underneath it
>   is still what you would need if the situation recurred; the box is not,
>   because there is nothing outstanding. Whatever superseded it says so on the
>   spot.

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

Moved out of this file to keep it small enough to load every session. See
`STATUS.md` for the current phase and `docs/phases/` for the punch list,
plan section, and probe findings bundled per phase.

Release process moved to `docs/release-checklist.md` (was Section D).
AI reviewer bootstrap moved to `docs/ai-reviewer-setup.md` (was Section E).

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
  the **Probe findings** section of the current phase file (`docs/phases/phase-N.md`,
  per `STATUS.md`) and cite the finding number in the PR description.
- **New user-facing setting or command?** Add it to `package.json` contributions;
  the docs reference is *generated* from there, so never hand-edit the tables —
  regenerate them and commit the result, or CI will fail the diff check.
- **Docs ship with the slice, not at the end** (`PRODUCTION_PLAN.md` §4.1). A
  behaviour change with no doc change is an incomplete PR.
- **Settled a §6 open decision? Write the ADR** in `docs/adr/` in the same PR.
  The code records what; only the ADR records why.
- **Keep `main` releasable.** If a slice leaves the extension unusable, it was
  scoped wrong.

# AI reviewer bootstrap and smoke test

Moved out of `RUNBOOK.md` (was Section E) so the maintainer runbook stays
small. Open this only when setting up or troubleshooting the AI PR
reviewers — not needed for normal slice work.

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
> TypeScript. 0a-ii has since merged, which was the last precondition E1 named.
> The evidence that the reviewers work is in the banner above and it is
> specific — three tasks that came out of their findings — rather than a claim
> about every pull request, which nothing written here can check.
>
> **E1–E5 lost their ☐ boxes on 2026-08-19.** They had kept them for three days
> under a banner saying they would never be run, and a ☐ in this runbook means
> "a manual step you perform" — so a reader scanning for open work found five,
> directly above the release punch list. The steps are unchanged; only the boxes
> are gone.

**E1 (not run).** Confirm the workflows are on `main`. Nothing works until they
are.

> **Also confirm the Claude GitHub App is installed on the repo** —
> https://github.com/apps/claude → Configure → repository access. This is a
> per-repo step, it is not Azure, and nothing in the workflow file or the Entra
> config hints at it. Without it `azure/login` succeeds and the action then dies
> with `401 Unauthorized - Claude Code is not installed on this repository`.
> Installed here 2026-08-12.

**E2 (not run).** Create a throwaway branch with deliberately bad code. Seed it
with defects that match the *retailored* prompts, so a silent bot and a working
bot look different: a `fetch` with no timeout, an empty `catch` with no
fail-soft comment, `Math.random()` in a PKCE verifier, a token written to
`console.log`, a user-facing string not wrapped in `l10n.t()`, an `as any` cast
across an API boundary, and an inline `if (version === "3.5")` outside
`src/dialects/`. A reviewer that misses **all** of those is misconfigured, not
merely quiet.

The file `test/scratch/reviewer-smoke.ts` is already prepared in your working copy.

```bash
git checkout main && git pull --ff-only && git checkout -b ci-reviewer-smoke-test
git add test/scratch/reviewer-smoke.ts
git commit -m "test: reviewer smoke test"
git push -u origin ci-reviewer-smoke-test
gh pr create --base main --head ci-reviewer-smoke-test --fill
```

**E3 (not run).** Confirm **both** reviewers post inline comments plus a
summary.

**E4 (not run).** For the Claude reviewer, open the Actions log and check the
success signals: `is_error: false`, `subtype: success`, `num_turns > 1`, a real
non-zero `total_cost_usd`, and `modelUsage` entries with `provider: "foundry"`.

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

**E5 (not run).** **Close the smoke-test PR without merging** and delete the
branch. The bad code must never reach `main`.

```bash
gh pr close ci-reviewer-smoke-test --delete-branch
```

---


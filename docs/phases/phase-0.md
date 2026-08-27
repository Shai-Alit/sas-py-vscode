# Phase 0 — Repository foundation

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 0 — Repository foundation

Nothing here is interesting, and all of it is load-bearing. Doing it first keeps
history clean and means every later PR lands into a working gate.

**0a — Scaffold, hygiene, and licensing.** Executes the settled licence decision —
`LICENSE` becomes Apache-2.0 and ADR-0000 records why.
Then `.gitattributes` (`* text=auto eol=lf` — dev is Windows, CI is Linux; this
must be the *first* file so history stays clean), `.gitignore`, `README.md`,
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md` (Keep a
Changelog 1.1.0), issue/PR templates, `CODEOWNERS`, `dependabot.yml`, and a
`NOTICE` recording upstream attribution. Also **copy `PROBE-FINDINGS.md` into the
repo** — the plan cites it throughout and it currently lives outside — and stand up
the `docs/` skeleton (`docs/dev/`, `docs/architecture/`, `docs/adr/` with ADR-0000
recording the licence decision) per §4.1. *Small.*

**0a-ii — AI reviewer bootstrap.** The two reviewer workflows
(`claude-review.yml`, `ai-review.yml`, `.github/scripts/ai_review.py`), merged
early and deliberately: they must exist on `main` before they can review anything
(§7), and validating them here means we're not debugging OIDC while also trying to
land real code. Azure-side setup — the federated credential for
`repo:Shai-Alit/sas-py-vscode:pull_request`, the Cognitive Services User role, and
the repo secrets/variables — was completed **2026-08-11** and is not part of this
slice. Ends with the throwaway smoke-test PR that proves both bots engage, then
closes **without merging**. *Small.*

> **Why this moved out of 0d-ii.** Reviewers that arrive after the code they
> should have reviewed are decoration. The only genuine ordering constraint in
> Phase 0 is that `.gitattributes` lands first, and 0a satisfies it — so the
> reviewers can be live from the second PR onward. 0d-ii keeps only the security
> scanning it was always going to carry.

**0b — TypeScript toolchain.** `package.json` extension manifest skeleton,
`tsconfig` (strict), ESLint + Prettier, esbuild/webpack bundling, `.vscodeignore`,
the copyright-header check (adapted from the SAS extension's `check-copyright.mjs`,
**extended to require a modified-file notice** on ported files), `@vscode/l10n`
setup and `l10n/bundle.l10n.json` extraction, and npm scripts that mirror CI.
Settle three things here: the configuration namespace, the **workspace-trust
posture**, and whether we ever ship a **web/browser** target. *Small/medium.*

> **Workspace trust is not a formality for this extension.** Our entire purpose is
> executing code on a remote corporate system. Copying the SAS extension's
> `untrustedWorkspaces.supported: true` unthinkingly would mean opening an
> untrusted folder can run its `.py` against production Viya. *Recommend
> `"limited"`, with execution commands disabled until trust is granted.*

**0c — Test harness.** Mocha + Chai + Sinon, `@vscode/test-electron` integration
runner, **plus the HTTP mocking layer** (nock or msw) and `test/fixtures/`
(*as built: Mocha + Sinon on `node:assert/strict`, no Chai — a second assertion
vocabulary earns nothing once the first one is in the tree; msw rather than nock*)
structure with per-generation subdirectories. Coverage instrumentation (c8) with
a threshold that starts realistic and ratchets. A trivial passing test proves the
whole harness. *Medium.*

**0d-i-a — Core CI and packaging.** Lint/format, type-check, copyright and
coverage gates; the test matrix (Node floor and working version × ubuntu /
windows / macOS, `xvfb-run` on Linux for test-electron — *as it now stands: the
floor and the current Active LTS, 22.18.0 and 24, after
[ADR-0018](../adr/0018-the-node-baseline.md) made the floor a derived value*);
`.vsix` packaging with
an assertion on what the package actually contains, uploaded as an artifact.
*Medium.*

**0d-i-b — Docs CI.** The **docs job** from §4.1 — generate the settings and
command reference from `package.json`, fail on any diff against the committed
copy, check that internal and external links resolve, and type-check every
`docs/` sample that claims to run. *Medium.*

> **Why 0d-i split.** 0d-i-b is not more CI wiring; it is choosing a static-site
> generator and writing a reference generator, neither of which exists yet.
> Bundling that with the test matrix would produce one PR where a reviewer has to
> hold a tooling choice and CI mechanics in mind at once, and the tooling choice
> is the part that deserves undivided attention. Same reasoning that split 0a
> and 0d.

**0d-ii-a — Supply chain.** The dependency audit gate — hard on the production
tree at any severity, allow-listed with expiry dates on the dev tree — and the
install-script policy: an `allowScripts` field in `package.json` denying every
package that asks to run code at install time, enforced by a dedicated
`supply-chain` CI job and by a unit test that reads the lockfile. *Medium.*

**0d-ii-b — Scanning.** CodeQL, a repo-local scanner for credential-shaped
strings, and the adapted `AI-PR-REVIEWERS-RUNBOOK.md` checked into the repo for
future maintainers. The reviewer workflows themselves moved to **0a-ii**. *Small.*

> **Why 0d-ii split.** Same reasoning as 0d-i. 0d-ii-a is a policy decision that
> had to be settled by experiment — whether each install script is load-bearing
> is a question only a clean install can answer, and the answer reversed what the
> runbook had assumed about esbuild. 0d-ii-b is mostly workflow wiring. Bundling
> them would put a supply-chain argument and a pile of YAML in front of one
> reviewer at the same time.

> **The constraint that shaped 0d-ii-a.** `allowScripts` is understood only by
> npm 12.0.0+, and npm 12 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0` — so it
> cannot run on the Node 20.19.0 floor §4 claimed at the time and the matrix
> tested. (The floor moved to 22.18.0 on 2026-08-18 — see
> [ADR-0018](../adr/0018-the-node-baseline.md) — and the constraint survives
> intact, because 22.18.0 is still below npm 12's `^22.22.2`.) Rather
> than move the support floor as a side effect of a security slice, the policy is
> enforced in one job that can run it. The rest of CI still installs with those
> scripts running, and `docs/dev/building.md` says so rather than implying a
> guarantee that is not there.

*Exit:* a green CI on an empty extension that installs and activates.


---

## Runbook

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

☑ **P33 — `npm run test:live` run for the first time, 2026-08-19, against a live
Viya 4 deployment.** §8 of the plan makes "the live tier passes against a real
Viya 4" part of the definition of done, and until this date it had never been
run at all — written in 0c, type-checked ever since, and unverified. Node
24.18.0, npm 11.16.0, Windows. Four runs, each changing exactly one thing.

1. **Unconfigured**, with no `PYTHON_ON_VIYA_*` variable in the shell —
   confirmed by printing the matching variable names first, which came back
   `(none)`. Result: `0 passing, 1 pending`, exit 0. Gate two skips rather than
   fails, which is the property that keeps this tier from being switched off on
   machines that cannot run it.
2. **Configured**, URL and token exported from a credentials file outside the
   repository and never echoed — only `url is https: true` and the token's
   length. Result: `TypeError: fetch failed`, caused by `unable to verify the
   first certificate`. That is the TLS handshake, not the request.
3. **With `NODE_EXTRA_CA_CERTS`** pointing at a file carrying three
   certificates. Result: the handshake completed and the request returned
   **406**.
4. **With the media type corrected.** Result: `1 passing`. Repeated against the
   deployment's published CA file rather than the one that happened to be at
   hand: `1 passing` again.

**The 406 is the finding, and it is not about this deployment.** The test asked
`/identities/users/@currentUser` for `application/vnd.sas.identity+json` — the
media type finding 6 records as a 406, and the one `src/auth/identity.ts:71-75`
names in as many words as the guess to avoid. The extension has been asking
correctly since 1b-i; only the live test carried the refuted string, and it
carried it for the entire life of the tier. Nothing in the other two tiers could
have found it. The test now **imports** `CURRENT_USER_PATH` and
`IDENTITY_SUMMARY_TYPE` from the module under test rather than restating either,
which makes it the same claim instead of a copy of one — the rule to apply to
every live test added from here. The job-creating one now exists and follows it:
`test/live/viya4-job.test.ts` imports every path, relation, media type and bound
it exercises from `src/compute/`, down to the Mocha timeout, which is computed
from `MAX_WAIT_WINDOWS`, `DEFAULT_WAIT_SECONDS` and `WAIT_MARGIN_SECONDS` rather
than written as a number — all three, because the wait's real ceiling is thirty
twenty-five-second windows and a version of that line computed from the first two
sat *below* the bound it was meant to sit above. See P40 below.

**The certificate is a property of the tier, not of the deployment.** The live
tier runs under bare `node`, which trusts its own bundled CA list; the extension
never meets this because VS Code loads the OS certificate store into the
extension host (`http.systemCertificates`, default on). So a developer whose
editor talks to Viya perfectly well will still see the tier fail on TLS, which
is a confusing first impression of a tier they have just been asked to trust.
`docs/dev/testing.md` now says so, with both fixes — `NODE_EXTRA_CA_CERTS` and
`node --use-system-ca` — and the warning that the file must hold the *issuing*
authority, since "unable to verify the first certificate" means the deployment
sent a leaf whose issuer Node cannot find.

**The interval is the risk.** A live test written in one phase and first run
three phases later is unverified for the whole gap, and reads as covered the
entire time. Run this tier at the end of any slice that touches a request the
extension makes, not at the end of the phase.

☑ **P40 — the live tier's three gates, now that one test writes. Run
2026-08-19 against deployment A, all six steps as expected.** P33 exercised
gates one and two against a read-only suite; gate three had **no caller at all**
until `test/live/viya4-job.test.ts` landed, so `PYTHON_ON_VIYA_ALLOW_MUTATION`
was unit-tested and never reached. This is the run that proves the whole gate
stack on the tier as it now stands, and it is one procedure rather than two
because the job test had to exist before the mutation gate could be observed
refusing anything.

Results, in step order: `0 passing, 2 pending` and exit 0; a load-time refusal
naming the URL variable; `1 passing, 1 pending` over a baseline of three live
sessions; `2 passing`; `no-such-context` with a count of thirteen contexts and no
names; and `before=3 after=3 new=0`. The duration of the job test was not
captured and is still worth having before Phase 3 depends on it. Three things
the run changed about the procedure itself are folded into it below — the
certificate advice in the preamble, `env -u` in step 1, and the loss of the
timestamp fallback in step 6 — and two defects it exposed are listed after it.

Before any of it: the tier runs under bare `node`, so the deployment's TLS chain
has to be trusted explicitly. **Prefer `NODE_OPTIONS=--use-system-ca`** —
measured working here, and it keeps a per-machine pem path out of the procedure.
`NODE_EXTRA_CA_CERTS` at the **issuing** authority is the fallback, and P33 above
has the diagnosis; but do not sit waiting for its `unable to verify the first
certificate` to appear, because that string is what the connectivity suite
surfaces and the job suite prints problem codes rather than free text on purpose,
so the same misconfiguration reaches you there as a bare `compute-unreachable`.
Take the URL and token from `creds.json` and never echo the token; print its
length if you want a check. Note that a connect **timeout** is not any of this:
it is the VPN, and it cost a step-3 re-run on the day.

1. **Nothing configured.** Run `npm run test:live` under `env -u` naming all six
   variables — the four credentials `_VIYA4_URL`, `_VIYA4_TOKEN`, `_VIYA35_URL`
   and `_VIYA35_TOKEN`, plus `_ALLOW_MUTATION` and `_VIYA4_CONTEXT`.

   Expected: `0 passing, 2 pending`, exit 0. Two, not one: both suites skip. A
   `1 pending` would mean mocha loaded only one of them, which points at the
   `spec` glob in `.mocharc.live.json` and not at the compiler — `test:live` is
   `compile:test && mocha`, so a file that failed to compile stops the run
   before mocha is reached and produces no counts at all.

   **`env -u` rather than "open a fresh terminal", which is what this step used
   to say and which does not work.** On Windows these names can live in the user
   environment, so every new shell inherits them; the first attempt on 2026-08-19
   was run in a new terminal, connected to a real deployment, and was void.
   Unsetting them in the command makes the step reproducible whatever the machine
   holds. `_VIYA4_CONTEXT` is in the list because step 5 sets it to a deliberately
   bad value and a leftover would quietly break a re-run of step 4; the mutation
   flag is in it because `PYTHON_ON_VIYA_ALLOW_MUTATION` is prefixed precisely so
   that some other project's bare `ALLOW_MUTATION` cannot open this one's write
   gate. A step that assumes a clean shell is a step that passes by doing
   nothing.

2. **A plaintext URL.** Set `PYTHON_ON_VIYA_TEST_VIYA4_URL` to the deployment's
   host with `http://` in front of it, set the token, and run again.

   Expected: the run **fails** rather than skipping, with the gate's own message
   naming the variable, and nothing leaves the machine. Refusing rather than
   skipping is the point here: a token over plaintext is the one misconfiguration
   that must not be quietly tolerated.

3. **Configured, mutation withheld.** Put the URL back to `https://`, leave
   `PYTHON_ON_VIYA_ALLOW_MUTATION` unset, and run.

   Expected: `1 passing, 1 pending`. The connectivity test passes; the job suite
   skips itself. This is also the pair of counts that separates "not configured"
   from "configured but read-only" — step 1's `0 passing, 2 pending` is the
   other one, and the job suite alone cannot tell you which situation you are in.

   Then, with the `viya-api-probe` skill and `creds.json`, `GET
   /compute/sessions` and **keep the result**. This is the baseline step 6
   compares against, and it is only that: a listing taken here cannot show that
   the withheld gate created nothing, for the same reason step 6 spells out — a
   `python-on-viya` in it may be left from any earlier run. What shows the gate
   held is the `1 pending` above, which is mocha reporting that the suite never
   entered the test body at all.

4. **Mutation allowed.** Export `PYTHON_ON_VIYA_ALLOW_MUTATION=1` and run.

   Expected: `2 passing`. The job test resolves a context, starts a session,
   submits one `%put` of a per-run marker, reads the marker back out of the log,
   and deletes the session. Note roughly how long it takes: the session launch
   dominates, and the number is worth having before Phase 3 depends on it.

5. **The wrong context name, optional but cheap.** Keep everything from step 4
   and add `PYTHON_ON_VIYA_TEST_VIYA4_CONTEXT` set to a name that does not exist.

   Expected: a failure that says how many compute contexts the account can see
   and points at the variable. A count and no names, on purpose — a context name
   can carry a customer's or a team's name in it and this message ends up in
   terminals and screenshots. If the count is `0` the problem is permissions, not
   spelling.

6. **Nothing left running.** `GET /compute/sessions` again and compare against
   the listing kept at step 3.

   Expected: no session present now that was not present then. **Compare ids, and
   only ids.** The name is `SESSION_NAME`, a constant in `src/compute/session.ts`,
   so every session this extension has ever started on this deployment carries
   it — a `python-on-viya` in the list may be one a previous run or a previous
   day left behind, and "none from this run" is not a thing the name can tell
   you. The baseline is what makes the question answerable, and on 2026-08-19 it
   gave `before=3 after=3 new=0`.

   An earlier draft of this step offered `creationTimeStamp` as a second
   discriminator. **There is no second discriminator**: the same run measured the
   session collection item as carrying `id`, `links`, `owner`, `version`, and
   `name` only where the session has one — no timestamp, no `state`, no
   `attributes`. Finding 56 in `PROBE-FINDINGS.md` records it. Keep the baseline
   file.

   This step is the whole point of the procedure's tail. The suite deletes its
   session in an `after` hook that runs even when the test itself failed, but a
   cleanup failure is warned about rather than asserted — so a green run is *not*
   evidence, and a hook that silently stopped working would leave a SAS process
   alive on a real deployment with nothing anywhere to say so. If the warning did
   appear, it names the session's constant name and the failure's problem code
   and deliberately not its id; the id is in the listing you just took.

☐ **Gate two skips a half-configured tier instead of refusing it.** Found by
accident during P40 on 2026-08-19, when a mangled paste set
`PYTHON_ON_VIYA_TEST_VIYA4_TOKEN` and left `PYTHON_ON_VIYA_TEST_VIYA4_URL`
unset: the run reported `0 passing, 2 pending` and exited 0, which is
indistinguishable from a machine where the tier was never set up.

That is the failure gate two exists to prevent, and it is arguably worse than
the plaintext case it *does* refuse, because plaintext at least shouts. A typo
in one of the two variable names silently disables the tier, and the operator's
evidence that it ran is a pending count that looks exactly like success. The
fix is in `test/helpers/live-gate.ts` and is the same shape as the `https://`
check: one of the pair present and the other absent is a **throw**, not an
`undefined`. Wants a unit test alongside the ones the gate already has, so it
is a source change and not a docs one — deliberately left out of the phase-2
review PR rather than smuggled into it.

☐ **`test/live/viya4-connectivity.test.ts:40` calls `fetch`.** The extension's
transport is `https.request`, chosen over `fetch` for system certificate trust
(see the transport ADR), so the older of the two live suites exercises a
transport `src/` never uses. Its failures are undici's — a
`ConnectTimeoutError` on undici's ten-second default is what a dropped VPN
produced on 2026-08-19 — and they say nothing about what the extension would
have done. `viya4-job.test.ts` does not share the problem: it goes through
`createComputeClient`. Port the connectivity check onto the real client in 3a,
or delete it in favour of the job suite, which subsumes it.

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
"sharp edge" paragraph in [docs/dev/ci.md](../dev/ci.md) — that is the
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
[ADR-0004](../adr/0004-documentation-toolchain.md); summarised in
PRODUCTION_PLAN.md §4.1. The short version: VitePress fails its own build on
dead internal links, so the link gate rides along with a build we already run,
and external rot is somebody else's outage rather than a reason to redden a PR.

☑ **The sweep's one false positive fixed 2026-08-18: the Visual Studio
Marketplace answers `404` to `HEAD` and `200` to `GET`.** Noticed because
`scripts/check-links.mjs` reported the `SAS.sas-lsp` listing that
`docs/connection-profiles.md` links to as broken; the page is live, and fetching
it with `GET` returned `200` with the extension at v1.20.0. `probe()` retried
with `GET` on `403`, `405`, `429` and `501` — the statuses a server plausibly
returns because it dislikes the method — and `404` was missing from that list
because a `404` normally means what it says. It is now included. A genuinely
missing page is still reported `404`, because the fallback returns the *second*
answer; the cost is one extra request per dead link.

No unit test accompanies it: `probe` and `classify` are module-private, and the
script exports only `isSelfLink`, `selfLinkTarget` and `extractLinks`. Exporting
a function so a test can reach it would be the tail wagging the dog for a
one-line status list, and the sweep is not a PR gate — `link-check.yml` runs it
weekly and opens an issue, so the observable failure of this defect was a
spurious issue once a week, not a red pull request. `npm run verify` does not
run it at all; only `docs:links:self` rides along there.

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

☑ **Corrected 2026-08-16, on `chore/override-vite-6`: four of the seven were
fixable all along.** Taking the entry above at its word ("re-check") found that
the vite advisories are ranged `<=6.4.1`/`<=6.4.2` and that **vite 6.4.3 shipped
2026-06-01**, before the allow-list was written. `overrides: { "vite": "^6.4.3" }`
in `package.json` pins it under `vitepress@1.6.4`, brings `esbuild ^0.25` with it,
and `npm audit` drops from seven advisories to three. The four entries are
deleted from `scripts/advisory-allowlist.json` — an entry matching no advisory
fails the gate, so this is not optional bookkeeping. The mocha half of the
original entry was re-measured and still holds. **The reasoning error: it asked
whether `vitepress` could move and never asked whether `vite` could.** A
transitive advisory has two escape routes; check both before writing `no fix`.
The override is outside vitepress's declared range, so `npm run docs:build` is
the evidence it works — see [ADR-0005](../adr/0005-supply-chain-policy.md).

☑ **The push banner's "1 high, 1 moderate" reconciled 2026-08-18 — it is the
allow-list, seen through a different instrument.** GitHub had been reporting two
alerts on `main` since the vite override landed, and nobody had matched them up.
They are `GHSA-5C6J-R48X-RMVQ` (high) and `GHSA-QJ8W-GFJ5-8C6V` (moderate), both
against `serialize-javascript`, both already allow-listed and in date until
2026-11-12. The count differs from `npm audit`'s three because Dependabot does not
surface the `low` `diff` advisory in the banner, not because the trees disagree.
Re-measured the escape route at the same time: `mocha` is still `11.8.0` latest
with `12.0.0-rc.6` on `next`, so the fix that does not exist in the entry still
does not exist. Nothing to change; the value of the exercise was turning an
unexplained banner into a known one.

☑ **Both `serialize-javascript` alerts cleared 2026-08-27 — the escape route the
2026-08-18 entry re-measured on the wrong axis.** That re-measure checked whether
`mocha` had moved and stopped there. It had not asked whether
`serialize-javascript` itself had a fixed release: **7.0.5 shipped 2026-03-25**,
five months before the reconciliation entry called the fix non-existent, and it
closes both `GHSA-5C6J-R48X-RMVQ` and `GHSA-QJ8W-GFJ5-8C6V`. `overrides` in
`package.json` now pins `serialize-javascript ^7.0.5` under mocha (npm resolves
`7.1.0`); 7.x has no dependencies and a `node >=20` floor, `npm run test:unit`
passes its 1122 cases on it, and `npm audit` drops to the single `low` `diff`
advisory. Same shape as the vite correction on 2026-08-16, same lesson a second
time: **checking the parent's version is not checking the child's.** See
[ADR-0005](../adr/0005-supply-chain-policy.md)'s 2026-08-27 amendments.

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

> **Amended 2026-08-18.** The floor is 22.18.0 now and the matrix legs are
> 22.18.0 and 24 — see ADR-0018. The reasoning above is unchanged: 22.18.0 is
> still below npm 12's `^22.22.2`, so the pinned job is still the only place the
> control can run. `engine-strict` with an `engines.npm` floor would still fail,
> and now on *every* leg rather than only the Node 20 ones — the Node 22 legs
> get npm 10.x, the Node 24 legs npm 11.x, and neither is 12. The distance to
> the revisit trigger is what shrank.

☑ **Divergence noted in `docs/dev/building.md`, 2026-08-12.** New section,
*Install scripts, and why your install differs from CI's*: the policy, the fact
that every job but `supply-chain` runs npm 10.x and therefore *does* run those
scripts, the `npm config get strict-allow-scripts` trap, and the
`npm install-scripts ls` / `deny` / `approve` loop. It also records a fragility
worth knowing: `.nvmrc` says `22` unpinned, which is the only reason CI clears
npm 12's `^22.22.2` floor — pinning it to an exact lower 22.x breaks the job on
its `npm install -g` step for reasons unrelated to the change that pinned it.

> **Amended 2026-08-18.** "npm 10.x" above is now "npm 10.x or 11.x": the matrix
> moved to Node 22.18.0 and 24 (ADR-0018), and Node 24 ships npm 11.x. Neither
> understands `allowScripts`, so the divergence the section records is the same
> divergence.

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
[ADR-0006](../adr/0006-scanning-posture.md). Two defects found by running it
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
[ADR-0007](../adr/0007-connection-profile-storage.md) and grounded in a
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


---

## Probe findings

_No live-Viya probes recorded for this phase yet._

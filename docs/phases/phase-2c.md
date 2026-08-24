# Phase 2c — Job creation, job state, and the log pump

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

_Not yet detailed in PRODUCTION_PLAN.md beyond the phase list._

---

## Runbook

# 2c-pre — probe the job log (docs only)
git checkout -b phase-2c-pre-log-probe
git commit -m "docs(probe): record the job log wire shape and long-poll behaviour"

# 2c-i — job creation, job state, and one page of log
git checkout -b phase-2c-i-jobs
git commit -m "feat(compute): add job creation, job state polling, and log paging"

# 2c-ii — the pump
git checkout -b phase-2c-ii-log-streaming
git commit -m "feat(compute): stream a job's log as it runs"
```

### Interlude — the Node baseline (2026-08-18)

☑ **`engines.node` raised from `>=20.19.0` to `>=22.18.0`, and the `.nvmrc` leg
of the test matrix dropped in favour of Active LTS.** Settled in ADR-0018. Node
20 reached end of life on 2026-04-30, so the floor named a runtime that no longer
receives security fixes; more to the point, the floor was never independently
chosen — VS Code's extension host has run Node 22 since **1.101**, and
`engines.vscode` already requires 1.104, so 20.19.0 described a runtime the
extension cannot be loaded on. 22.18.0 is the exact Node that 1.104 embeds.

The matrix was 20.19.0 (the floor) and a bare `22` matching `.nvmrc`. With the
floor at 22.18.0 that second leg stops being informative — newest-22.x differs
from the floor only at patch level — so it became **24**, the current Active
LTS, which is a forward-break detector rather than a near-duplicate. What is
lost is newest-22.x on windows and macOS; `verify` still installs from `.nvmrc`
and runs the unit tier on it, on ubuntu. `esbuild.mjs`
targets `node22`, and `.nvmrc` stays at an unpinned `22`, still resolving to the
newest 22.x and still the only reason `supply-chain` clears npm 12's `^22.22.2`.

> **What did not change, and this is the point.** 22.18.0 is *below* `^22.22.2`,
> so ADR-0005's whole design survives untouched: the policy still cannot run
> outside the one pinned job. The revisit trigger there is now one minor floor
> bump away rather than a major one, which is worth knowing but is not an
> instruction to take it.

☑ **`@types/node` was pinned to 26.2.0 and typed against a runtime we do not
ship on. Fixed 2026-08-19.** Found during the Phase 2 review, 2026-08-18. It is
not the same defect as the floor — nothing had broken — but the types described
Node 26 APIs while the host runs 22, so `tsc` would accept a call that does not
exist at runtime.

**Pinned exactly to `22.18.13`, not to the `^22` this item first proposed.**
`22.18.x` is the `@types/node` line that describes Node 22.18.0, which is the
Node VS Code 1.104 embeds and therefore the one `engines.node` is derived from
(ADR-0018). `^22` would have floated to 22.20.x and reintroduced the same defect
a minor at a time — narrower than four majors, identical in kind. The exact pin
also matches what every other `@types` package in this repo already does, and
`@types/vscode`'s reasoning transfers word for word: the types are what tell the
compiler which APIs exist, so holding them at the floor is the whole mechanism.

`.github/dependabot.yml` carries a matching `ignore` entry. `@types/vscode` has
`vsce`'s `validateVSCodeTypesCompatibility` enforcing the same rule from the
packaging side; `@types/node` has nothing equivalent, so that entry is the only
guard and the comment on it says so.

### Phase 3 — Run Python

☑ **Before 3a — build the submission fidelity corpus, and let it choose the
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
Running an uploaded file is favoured precisely because a file transfer has no
tokeniser in the middle; if the inline form cannot pass the corpus, that is the
answer rather than a reason to iterate on an escaper. See `PRODUCTION_PLAN.md`
§1.5 item 1 and §4.

> **Why this gets its own item.** Every other failure in this project announces
> itself. This one does not: a mis-tokenised program runs and means something
> else, and the user's evidence for that is a wrong number, not an error.

**The mechanism is now chosen — 2-pre chose it, on 2026-08-16.** Upload plus
`proc python infile=<fileref>;`, for the reason this item predicted: the inline
form cannot pass the corpus. The corpus still ships, and it still asserts byte for
byte, but its job has changed from *proving an escaper* to *proving the upload
path* — that what the interpreter read is what the editor held, across CRLF, tabs,
non-ASCII, an empty file and no trailing newline. Keep the hostile cases anyway:
they are now the evidence that nothing tokenises the file, and the first case to
fail would tell us that something does. Findings 31–35 in `PROBE-FINDINGS.md`.

**Written 2026-08-19, committed 2026-08-20 as `8063375` on branch
`phase-3-pre-submission-corpus`, merged 2026-08-20 as `629534b` (PR #46).**
The fourteen-file corpus, a new `src/compute/fileref.ts`
(`createFileref`, `writeFilerefContent` — the fileref half of ADR-0014's
mechanism, composing no `infile=` and touching no job, which stays 3a's),
`ComputeRequest.rawBody` on `src/compute/client.ts` plus `TransportRequest.body`
widened to `string | Uint8Array` in `src/auth/transport.ts`, three new
`contracts/viya4.yaml` entries (`fileref_create`, `fileref_get`,
`fileref_content_put`), a unit suite against a recorded transport
(`compute-fileref.test.ts`, `submission-corpus.test.ts`, new `raw bodies` cases
in `compute-client.test.ts`), and a live-tier suite round-tripping five fixtures
against a real Viya 4 (`test/live/submission-corpus.test.ts`). One existing
test needed a one-line fix (`test/integration/auth/browser-flow.test.ts`),
where a fake transport's `new URLSearchParams(init.body)` stopped compiling
once `body` could be a `Uint8Array`.

Checked clean before `npm run verify`: both `tsc` projects, Prettier,
`check-contracts`, `check-coverage-scope`, `check-secrets`, `check-copyright`,
and one adversarial subagent pass over the finished diff (no blocking findings;
it flagged two tautological
`assert.equal(FILEREF_CONTENT_TYPE, "application/octet-stream")` tests that
never exercised `client.ts`'s real header logic — fixed by adding the
transport-level `raw bodies` suite to `compute-client.test.ts` and removing the
redundant one from `submission-corpus.test.ts`).

**`npm run verify` is green** — 892 passing, coverage
92.41/95.06/91.57/92.41 (statements/branches/functions/lines), all above the
92/95/91/92 floor with enough margin that the floor does not move this time:
each measured value's integer truncation matches the existing floor exactly.
One ESLint finding surfaced on the first run —
`@typescript-eslint/no-unnecessary-condition` on
`test/unit/compute-fileref.test.ts`, because Node's strict `assert.equal` is
`asserts actual is T`-typed and narrowing `put?.link.rel` had already narrowed
`put` itself, making a second `put?.etag` redundant — fixed by dropping the
`?.`. Second run was clean.

**The live tier has been run against a real Viya 4 (`verde`) and passes.**
Getting there surfaced two things worth recording, neither a defect in this
slice:

- **TLS, not a code defect, was behind six of the first seven live failures.**
  `verde` sends a leaf certificate with no intermediate, which Node cannot
  build a trust chain from without `NODE_OPTIONS=--use-system-ca` — exactly the
  scenario this file's own P40 preamble (§319–323) already predicted. The
  connectivity suite surfaced the real
  `unable to verify the first certificate` string because it uses `fetch` and
  prints free text; every other live suite goes through `describeFailure`,
  which prints only `problem.code`, so the identical misconfiguration reached
  the operator as a bare `compute-unreachable` with no hint why. Worth
  promoting that preamble paragraph into `docs/dev/testing.md`'s own preamble
  too, not just P40's, since it is now load-bearing for more than one slice's
  live run.
- **A `PYTHON_ON_VIYA_TEST_VIYA4_CONTEXT` override was never needed.** The
  file's own default, `SAS Job Execution compute context`, is valid on
  `verde` and was the whole time; an earlier attempt to override it with
  `Data mining compute context` failed on a capitalisation typo
  (`Data Mining compute context` is the real name) that turned out to be
  moot once the override was dropped entirely.

**Finding 57 in `PROBE-FINDINGS.md`** (added 2026-08-20) is the live evidence
behind this item's claims: the fileref's `upload` relation advertises
`application/octet-stream` itself, so `client.ts`'s own octet-stream default
for a `rawBody` request is never the arm actually taken on this path; a bare
relative `path` lands inside the session's own run directory, which is what
makes `createFileref` sending the same value for `name` and `path` defensible;
and four corpus cases (CRLF, UTF-8 multi-byte, no-trailing-newline, and a
genuinely empty file) round-tripped upload-then-read-back md5-identical.

**What this item does not cover**, worth stating rather than assuming since
the item otherwise reads as though the corpus settles the whole question:
nothing in any tier of it runs Python. The unit tier ends at "the bytes
reached the transport unchanged" and the live tier at "the deployment stored
them and handed them back". That `proc python infile=<fileref>;` then *reads*
those same bytes, and that a `\r\n` or a missing final newline does not change
what executes, are unproved and land with **3a**. Finding 31 is why this is
worth stating rather than assuming: the mechanism this replaced failed
*silently*. Also unproved: the read-back side of the live round trip goes
through Node's UTF-8 decoder, so it is only as faithful as
decode-then-re-encode — lossless for well-formed UTF-8 source, which every
case is by construction, and not a claim about arbitrary binary.

☐ **#135's open half — decide whether an absent `createSession` should fail the
connect at all.** `resolveContext` refuses before it posts anything, on the
reasoning that failing while the context's name is still in hand beats a failure
three steps later. Findings 54 and 55 leave that reasoning intact but remove its
premise: the absence is a fact about one response to one account, and the probe
that looked for it could not make it happen — so the pre-emptive refusal may be
turning a request Viya would have accepted into a connect that never happened.
The alternative is to follow the summary's `self` and read the resource before
giving up, or to post to the conventional sessions path and report whatever the
server says. Both are behaviour, both want tests, and neither belongs in a
corrections change — which is why this is here and not in that one. Decide it in
the next slice that touches connect.

☐ **3a punch list.** Written 2026-08-19, and it is mostly not new work — it is
the work six earlier items had already assigned to 3a, from five places, none of
them a list of what 3a has to do — one of them is a comment in a test file.
"Moved to 3a" and "goes to the 3a punch list" were written repeatedly against a
punch list that did not exist, so each of these was one slice away from being
lost. Where an item came from is
named, because the reasoning is at the origin and is not repeated here.

- ☑ **Refuse to submit into a busy session, and say so.** From the 2a-ii punch
  list, moved 2026-08-14 because the check has no caller until something
  submits — which is now. Finding 27: session state reads `running` while a job
  executes and returns to `idle` after; finding 29 leaves concurrent submission
  unobserved. This is the shared-window case's only defence, so it is not
  optional. `src/compute/sessionManager.ts` says under "what is deliberately not
  here yet" why the manager has no busy check; that comment comes out with this
  item. **Landed 2026-08-20 (slice 3a-ii)** as a seam rather than a submitter:
  3a's run path still does not exist, so `ComputeSessionManager` gained
  `startSubmission`/`endSubmission`/`isBusy` — a bare start/end pair keyed per
  profile id, not a wrapping `submit(profileId, run)` helper, because
  ADR-0017's log-streaming pump has not been designed yet and a wrapping
  helper would have to guess its shape today. Five new integration tests in
  `test/integration/compute/session-manager.test.ts` cover the refusal, the
  release, per-profile independence and idempotent double-ending. 3a still has
  to actually call this from its run command; nothing does yet.
- ☑ **Make `test/unit/backend-contract.test.ts` runnable against a real
  backend.** Its header says 3a's backend "should be able to run this same
  file", and all twenty-three cases call `createFakeBackend()` directly, so as
  written it cannot. Export it as a suite taking a factory and run it twice —
  once over the double, once over the `PROC PYTHON` backend. Doing this *first*
  makes the contract the specification for the slice rather than something the
  slice is checked against afterwards. **Landed 2026-08-20 (slice 3a-ii)**: all
  twenty-three cases moved into a new `test/helpers/backend-contract-suite.ts`,
  exported as `describeExecutionBackendContract(createBackend: BackendFactory)`.
  `test/unit/backend-contract.test.ts` is now nine lines that call it with
  `createFakeBackend`. The suite is typed against `FakeBackend` (`.runs`,
  `.finish`/`.emit`/`.abort`), not the bare `ExecutionBackend` seam — that is
  the interface 3a's own double has to satisfy to reuse this suite, and how
  that double gets driven is 3a's decision, not anticipated here. "Run it
  twice" is therefore still 3a's to finish, once its double exists.
- ☐ **Decide whether an absent `createSession` should fail the connect at all.**
  The #135 item immediately above this one has the reasoning and the two
  alternatives. It is on this list because "the next slice that touches connect"
  is 3a and nothing else names it.
- ☑ **Probe ADR-0014's two unsettled hand-over questions before designing
  around their absence** — `TIMEOUT` for Cancel, and `SRC` as a second hand-over
  path. Flagged in the 2-pre write-up as worth probing *before* 3a, which is a
  deadline this list is the only place that records. **Probed 2026-08-20
  (slice 3a-i, docs-only), findings 58–59.** Both questions settle in the
  direction of "nothing to design around": `TIMEOUT=` on `PROC PYTHON` bounds
  only the connect handshake — a submit block that opened with `timeout=2` and
  then slept 5 seconds completed normally in 6.88s — and does not exist at all
  on `SUBMIT` (a syntax error, not a silent no-op). `SRC=` parses, as finding 34's
  option list said it would, but is the same file-open code path `INFILE=`
  already uses — `src="print(1+1)"` fails with `ERROR: Failed to open the file
  on the INFILE= statement`, naming `INFILE=` even though `SRC=` was what was
  written — so it is not a second inline hand-over path. Neither finding changes
  anything 3a was going to build: Cancel still has no execution-time bound to
  rely on and must keep depending on the job's `cancel` relation (whether that
  stops a running step promptly is still unmeasured, per `job.ts`'s own note),
  and ADR-0014's `INFILE=`-via-upload mechanism remains the only real hand-over
  path.
- ☑ **Gate two of the live tier skips a half-configured tier instead of
  refusing it.** Found by accident during P40 on 2026-08-19: with the token set
  and the URL unset, the run reports `2 pending` and exit 0 — indistinguishable
  from a machine that was never configured, on a tier whose whole value is that
  it talks to a real deployment. The fix is in `test/helpers/live-gate.ts`, the
  same shape as the `https://` check already there: one of the pair present and
  the other absent must **throw**. It wants a unit test, and it is small enough
  to be the slice's first commit. **Landed 2026-08-20 (slice 3a-ii)**: `liveTarget`
  now throws, naming which variable is present and which is missing, and only
  returns `undefined` when neither is set. Two unit tests updated and one
  added — the half-configured test asserts a throw instead of `undefined`, the
  blank-value test does the same, and a new test pins the both-blank-equals-
  absent case so the two are not confused.
- ☑ **`test/live/viya4-connectivity.test.ts:40` calls `fetch`.** So the one live
  test that predates 3a exercises a transport `src/` never uses, which is the
  same defect class as a test that copies the logic under test. Port it onto
  `createComputeClient`, or delete it now that `viya4-job.test.ts` covers the
  same ground through the real client. **Landed 2026-08-20 (slice 3a-ii)**, and
  the fix named above turned out not to fit: `/identities/users/@currentUser`
  is an identity-service endpoint, not a `/compute/...` one, and
  `ComputeClient.send` only follows a `Link` under ADR-0010 — it has no way to
  reach a path outside the Compute service at all. Deletion was also wrong:
  `viya4-job.test.ts` requires `PYTHON_ON_VIYA_ALLOW_MUTATION` and skips
  without it, so removing this suite would leave nobody who has only set the
  URL/token pair with any live coverage at all. The actual fix ports the test
  onto `src/auth/identity.ts`'s `fetchCurrentUser` — the real production
  function for exactly this request, which already implements the finding-6
  summary/full media-type fallback this test used to re-derive by hand with a
  bare `fetch` call.

> **Before any of it, the submission fidelity corpus**, which has its own item
> above and is not repeated here. It is listed as "Before 3a" rather than as
> part of it because the corpus is what proves the mechanism 2-pre chose, and a
> backend written first would be a backend the corpus is then fitted around.

```bash

---

## Probe findings

## 2026-08-17 — The job log (2c-pre), before log streaming is written (Viya 4)

Slice 2c has to turn a submitted program into a stream of typed lines. Findings
19, 20 and 21 got as far as "the log is a paged collection of typed lines" and
stopped; no job representation had ever been dumped, the vocabulary of `type` had
never been enumerated, and whether the log endpoint's `timeout=` parameter really
long-polls was assumed from upstream's code rather than measured. That last one
is load-bearing: if `timeout=` were inert, upstream's `while` loop would be a hot
spin throttled only by network latency, and 2c would have to drive from the
**job-state** long poll instead — the one finding 28 measured releasing at the
moment of change. Not the *session*-state poll: finding 27 already ruled that
out, because completion is a property of the job and watching the session for
`idle` reports a run finished two to three seconds late.

**Mutating, and agreed first.** Nothing about a log is observable without a job
to produce one. Three throwaway compute sessions were created and each was
deleted in the same shell call under a `trap`; the jobs died with them. No
existing object was read, written or deleted. Session ids, job ids and the host
are scrubbed below, and the job-create `ETag` is omitted rather than replaced
because nothing here reads it; line text, field names, types and ordering are
reproduced exactly.

### Finding 46 — The job is six fields and ten relations, and two of them are the same URL

`POST /compute/sessions/{sid}/jobs` with
`Content-Type: application/vnd.sas.compute.job.request+json` and a body of
`{"name": ..., "code": [ ...statements... ]}` answers **201** with a `Location`
header, an `ETag`, and
`content-type: application/vnd.sas.compute.job+json; charset=utf-8; version=1`.
The representation is small:

```json
{
  "creationTimeStamp": "2026-08-17T17:21:21.463Z",
  "id": "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D",
  "sessionId": "11111111-2222-3333-4444-555555555555-ses0000",
  "state": "pending",
  "stateElapsedTime": 0,
  "version": 1,
  "links": [ ... ]
}
```

No `code` echoed back, no `name` echoed back — the name sent at create does not
survive into the representation, unlike a session's (finding 24). `state` is
`pending` at create, so a client that reads the create response and expects to
find a terminal state has to poll regardless. `stateElapsedTime` is a
server-side stopwatch on the *current* state, which makes it useful for a
progress message and useless as a total.

The ten relations:

| `rel` | method | `type` | href (relative to the job) |
|---|---|---|---|
| `self` | GET | `application/vnd.sas.compute.job` | *(the job)* |
| `state` | GET | `text/plain` | `/state` |
| `cancel` | PUT | **`null`** | `/state?value=canceled` |
| `delete` | DELETE | **`null`** | *(the job)* |
| `log` | GET | `application/vnd.sas.collection` | `/log` |
| `logAsText` | GET | `text/plain` | `/log` |
| `listing` | GET | `application/vnd.sas.collection` | `/listing` |
| `listingAsText` | GET | `text/plain` | `/listing` |
| `results` | GET | `application/vnd.sas.collection` | `/results` |
| `up` | GET | `application/vnd.sas.compute.session` | *(the session)* |

Three things fall out of that table. **`type` is explicitly `null` on `cancel`
and `delete`** — the open question finding 21 left is answered, and a contract
that types the relation's media type as a required string would reject a real
Viya response. Null means "no representation involved", which is exactly right
for a `DELETE` and for a `PUT` that carries its whole payload in the query
string.

**`log` and `logAsText` are the same href.** They differ only in `rel` and in
the media type, so a client that resolves a relation to a URL and then picks an
`Accept` header independently would silently get whichever one it asked for
regardless of which relation it looked up. The relation is the intent; the
`Accept` header is what actually decides. `listing`/`listingAsText` are the same
pair over the listing.

**`cancel` carries its own query string**, as the session's does (finding 21).
Appending a parameter to it requires `&`, not `?`, which is the kind of thing a
naive URL builder gets wrong exactly once.

### Finding 47 — A log line is three fields, and `count` is the running total

`GET {job}/log?start=0&limit=200` with
`Accept: application/vnd.sas.collection+json` answers **200** with
`content-type: application/vnd.sas.collection+json;version=2`. Each item has
exactly three keys — `line`, `type`, `version` — and nothing else: no timestamp,
no sequence number, no job id. Position in the collection is the only ordering
information there is, which is why `start` is the whole of the client's state.

`count` is the number of lines the job has produced *so far*, and it moved
10 → 11 → 12 across three consecutive polls of a running job. It is a live total,
not a page size and not a null. This is worth stating plainly because
`/compute/contexts` answers `count: null` whenever the collection is truncated
(finding 16), and code written defensively against that trap does not need the
same defence here. It does need the opposite caution: `count` on a running job is
stale the moment it is read.

### Finding 48 — `timeout=` is a real long poll, and on the log it is the only mechanism there is

Measured against a job printing one line per second, polling at the tail:

| Request | Elapsed | Status | Items |
|---|---|---|---|
| `?start=0&limit=200` (baseline, mid-run) | 0.33 s | 200 | 9 |
| `?start=9&limit=200&timeout=10` | 0.78 s | 200 | 1 |
| `?start=10&limit=200&timeout=10` | 1.02 s | 200 | 1 |
| `?start=11&limit=200&timeout=10` | 1.02 s | 200 | 1 |
| `?start=12&limit=200` *(no `timeout`)* | 0.27 s | 200 | 0 |

The three `timeout=10` polls each blocked for about as long as it took the next
line to appear and then returned it — one line, immediately, not ten seconds
later. The same request without `timeout` came back in 0.27 s empty. So the
parameter works, upstream's loop is not a hot spin, and **a client that omits
`timeout` and loops has written a busy-wait against a corporate network**.

The wait is honoured to its stated length. Against a job deliberately silent for
25 seconds:

| Request | Elapsed | Status | Items |
|---|---|---|---|
| `?timeout=10` | 10.27 s | 200 | 0 |
| `?timeout=5` | 5.37 s | 200 | 0 |
| *(no `timeout`)* | 0.56 s | 200 | 0 |
| `?timeout=60` | 6.34 s | 200 | 6 |

`timeout=60` was accepted without complaint and returned after 6.34 s, when the
silence ended — the value is a ceiling, not a delay. Note that this says nothing
about whether 60 is *honoured*: the request was released by a log line long
before the ceiling could elapse, so a server that silently clamps large values to
some smaller maximum would have produced exactly the same measurement. Two
timeouts have been observed actually elapsing — `timeout=5` at 5.37 s and
`timeout=10` at 10.27 s — and 10 is therefore the largest verified ceiling.
Treat anything above 10 as unverified, and do not rely on a long ceiling for correctness — the
loop must be correct at any clamp, because an early empty return is
indistinguishable from a short poll.

**There is no ETag on the log collection.** The response headers carry
`content-type` and no `etag` at all, so `If-None-Match` has nothing to send and
the conditional-request machinery that drives the *session state* long poll
(findings 19 and 28) simply does not apply here. That is a simplification worth
having: the log's cursor is `start`, and `start` is a number the client already
has to track.

### Finding 49 — Expiry is a 200 with an empty page, not a 304

Both expiry rows above are **200 with `items: []`**, never 304. The session state
resource answers `304` when its `wait` elapses (finding 28), so the two expiry
conventions that have actually been *measured* in this API disagree, and the
log's is the easier to consume: one status, one body shape, and "nothing
happened" is an empty array rather than a second code path.

The job-state resource's expiry is **still unobserved**. Finding 28 measured it
holding for `wait=20` and returning `200` after 12.96 s — but that was a release
*at the moment of change*, not a window running out, and nothing has yet let a
job-state `wait` elapse against an unchanged value. An earlier draft of this
finding claimed three expiry conventions; there are two measured and one
assumed, and the assumption is only that the job state behaves like the session
state it sits beside.

A consumer must therefore not treat an empty page as end-of-log. During a run it
means "nothing yet"; only the job's state says whether more is coming.

### Finding 50 — A terminal job short-circuits the wait

After the job reached a terminal state, a tail poll *with* `timeout=10` returned
in **0.26 s** with zero items. The server does not make a finished job's reader
sit out the full timeout.

This is the finding that makes the drain cheap. A stream that polls until the
state is terminal and then keeps reading until the pages come back empty pays
nothing for the final read, so there is no trailing ten-second stall at the end
of every execution and no need for the client to special-case its last poll.

### Finding 51 — Reading past the end is a 200, and `next` is the drain's terminator

`?start=71&limit=10` against a 21-line log: **200**, zero items, `count: 21`,
and `start` echoed back as `71`. No 400, no 416, no error document. A cursor that
overshoots is not a failure mode to defend against.

Paging a finished 21-line log at `limit=3` produced seven pages and stopped:

| Page `start` | items | relations present |
|---|---|---|
| 0 | 3 | `collection`, `first`, `last`, `next`, `self`, `up` |
| 3, 6, 9, 12, 15 | 3 each | *(above, plus `prev`)* |
| 18 | 3 | `collection`, `first`, `prev`, `self`, `up` |

`next` is absent on the last page and on every tail read of a running job, so
"follow `next` until it is gone" terminates and is the correct drain. Note that
the final page was *full* — three items, `18 + 3 = 21 = count` — and still
carried no `next`, so the drain must key on the link's absence and not on a short
page.

### Finding 52 — Four line types, and `note` is a catch-all that includes blanks

The full 21-line log of a job that printed one line and then failed, verbatim
except for scrubbing:

```
 0 source  '1    data _null_;'
 1 source  '2      put "PROBE NORMAL LINE";'
 2 source  '3    run;'
 3 note    ''
 4 normal  'PROBE NORMAL LINE'
 5 note    'NOTE: DATA statement used (Total process time):'
 6 note    '      real time           0.00 seconds'
 7 note    '      cpu time            0.00 seconds'
 8 note    '      '
 9 note    ''
10 source  '4    data _null_;'
11 source  '5      set nosuchlib.nosuchtable;'
12 error   "ERROR: Libref 'nosuchlib' exceeds 8 characters."
13 source  '6    run;'
14 note    ''
15 note    'NOTE: The SAS System stopped processing this step because of errors.'
16 note    'NOTE: DATA statement used (Total process time):'
17 note    '      real time           0.00 seconds'
18 note    '      cpu time            0.00 seconds'
19 note    '      '
20 note    ''
```

Four types appeared: `source` (6), `note` (13), `normal` (1), `error` (1). Four
observations, each of which constrains 3b's filter:

1. **`note` is not "a line beginning with `NOTE:`".** It covers genuine notes,
   their indented continuation lines, whitespace-only lines, and completely
   blank ones. Ten of the thirteen carry no `NOTE:` prefix — only indices 5, 15
   and 16 do — and six are empty or whitespace: four are the empty string
   (3, 9, 14, 20) and two are spaces only (8, 19). A filter offering "hide
   notes" would delete the log's
   vertical spacing along with them, which is a legitimate choice but must be a
   deliberate one.
2. **`normal` is the user's own output** — the `put` — and it is the rarest type
   in a log dominated by machinery. `normal` plus `error` is the pair a
   "program output only" view wants.
3. **The diagnostic is interleaved with the source echo, not appended after
   it.** Line 12 (`ERROR:`) sits between the echo of `set nosuchlib.nosuchtable;`
   and the echo of `run;`, because SAS emits it as it parses that statement
   rather than when the step runs. Here the error does follow the line it
   belongs to — but it arrives *before the step it is part of has finished being
   echoed*, so a renderer that assumes each step's source is contiguous will
   split it. Whether the line immediately above an `error` is reliably its
   source was not tested; one interleaving is not a rule.
4. **`warning` was not observed** and neither was any type beyond these four.
   Nothing in this probe produced a `WARNING:`, so the vocabulary is a floor,
   not a closed set — the client must pass an unrecognised `type` through rather
   than discard it.

Note also that the source lines are echoed with SAS's own line numbering, which
only happens because this probe submitted statements inline in `code[]`.
ADR-0014 chose upload plus `infile=` for 3a, and finding 35 established that
`infile=` echoes no source at all — so a real 3a log is **predicted** to carry no
`source` lines. That is a prediction, not a measurement: this probe submitted
inline `code[]` and never read a log produced through `infile=`. 3b's filter must
not be designed around `source` lines being present, and 2c should confirm the
prediction the first time it streams a real 3a submission.

### Finding 53 — A SAS `ERROR:` is a job state of `error`, and the session still settles to `idle`

The failing job's terminal state, read from `{job}/state` as `text/plain`, was
**`error`** — not `failed`, not `completed`. The session's own state one moment
later was **`idle`**: a job that errored does not poison its session, which is
consistent with finding 27's observation that the session lags the job at the
end. The session being reusable after a failed job is the useful part — the next
job may be submitted into it without a reset.

Upstream's terminal set is
`["done", "canceled", "error", "warning", "completed"]`. Only `error` and
`completed` have now been observed on a live deployment; `done`, `canceled` and
`warning` are inherited on trust, and `warning` in particular implies a
`WARNING:`-producing job reaches a distinct terminal state that finding 52 did
not provoke. Keep all five — the cost of an unobserved extra member is nil and
the cost of a missing one is a loop that never exits.

Once the session is deleted, the job's log answers **404** with
`application/vnd.sas.error+json;charset=utf-8;version=2` and a message that names
the *session*, not the job:

```json
{
  "version": 2,
  "httpStatusCode": 404,
  "errorCode": 5837,
  "message": "Not Found",
  "details": ["A session with the ID \"...-ses0000\" could not be found.", "path: /compute/sessions/..."]
}
```

So a log read that fails after a session dies is indistinguishable from finding
29's uniform 404 and carries the same diagnosis problem: the client cannot tell
"your session expired" from "that job never existed" by status alone, and must
read `details` or rely on its own record of what it created.

### What this settles

1. **The stream polls the log, not the state.** `timeout=` long-polls for real
   (finding 48), so the loop is `GET {job}/log?start=N&limit=L&timeout=T`,
   advancing `N` by the number of items returned. The session-state long poll is
   not needed to drive it.
2. **`timeout` is mandatory in that loop.** Omitting it turns the loop into a
   busy-wait; the parameter is the only thing standing between the design and a
   request storm.
3. **The expiry arm is a 200 with an empty array**, so there is one response
   shape to parse and "nothing new" is not an error (finding 49).
4. **Termination is: poll until the job state is terminal, then drain until
   `next` is absent** (findings 50 and 51), and the drain is free because a
   terminal job does not honour the wait.
5. **`start` is the entire cursor.** No ETag exists on the log, so nothing
   conditional needs to be tracked.
6. **`type` is passed through, not switched on.** Four values observed, the set
   is open, and `note` is a catch-all rather than a prefix test (finding 52).
7. **The contract checker has to change before 2c can describe a job.**
   `scripts/check-contracts.mjs` requires `via.from`, `via.relation` *and*
   `via.type` to each be a string, and a job's `cancel` and `delete` relations
   carry `type: null` (finding 46). The constraint is broader than the null: a
   *session's* `cancel` and `delete` **omit** `type` entirely, and `typeof
   undefined !== "string"` fails the same check — so the checker could already
   not describe those either, and nothing had noticed because no contract had
   yet needed to name them. Either `type` becomes optional-or-null on a `via`,
   or none of those endpoints can be declared at all — and an endpoint the code
   calls but the contract omits is precisely what the checker's other direction
   is there to catch. 2c has to resolve that, in code, in its own slice.

### What this probe did not settle

- **Whether `timeout` has a server-side maximum, or is silently clamped.** 60 was
  accepted and nothing larger was tried — but 60 never elapsed, because a log
  line released the request at 6.34 s, so a server clamping 60 down to something
  smaller would have produced an identical measurement. The only value observed
  running its full course is 10. A loop must therefore be correct whatever the
  real ceiling is: an early empty return is indistinguishable from a short poll.
- **The `warning` terminal state**, and whether a `WARNING:` line carries a
  `warning` line type. Neither was provoked.
- **What `listing` and `results` contain.** Both relations exist on every job and
  neither was fetched. `results` is likely where 3c's ODS output lives.
- **Whether the log survives the job but not the session.** `DELETE` on the job
  itself was never exercised — only the session was deleted — so whether a
  deleted job's log is readable is unknown.
- **Behaviour under a `limit` larger than the log.** `limit=200` and `limit=500`
  were used freely against small logs; no page-size ceiling was probed, and
  whether a very large `limit` is silently clamped is unknown.
- **Interleaving.** Only one job ran per session. Whether two concurrent jobs in
  one session produce independent logs, or whether Compute even permits the
  second, was not tested.

## 2026-08-19 — What an absent link means (#135), during the phase-2 review (Viya 4)

Punch-list item #135 has been open since the 2a-iii manual run on 2026-08-15: a
context picked from the picker was reported as offering no `createSession` link,
and the *same* context started a session two minutes later. The interesting
question is not why that one connect failed. It is what `resolveContext` is
entitled to *conclude* from an absent relation — because it concluded something
about the deployment, and `messages.ts` told the user so.

**Read-only.** Twenty-one `GET`s against the contexts collection and three
against one context resource. Nothing was created, updated or deleted and no
session was started. Context ids are omitted below; the names are SAS's own
defaults and say nothing about this deployment.

### Finding 54 — The collection item is a summary, and the resource carries three relations the summary never does

The same context, the same token, minutes apart. Below, `…` stands for the
`application/vnd.sas.` prefix and `→` separates a relation's request type from
its response type; a `—` means the relation carried neither. The collection
item:

```
GET /compute/contexts?limit=50
Accept: application/vnd.sas.collection+json

fields: createdBy, id, name, version

  rel              method  type / responseType
  self             GET     …compute.context
  alternate        GET     …compute.context.summary
  delete           DELETE  —
  createSession    POST    …compute.session.request → …compute.session
```

and the resource the item's `self` points at:

```
GET /compute/contexts/{id}
Accept: application/vnd.sas.compute.context+json

fields: createdBy, creationTimeStamp, description, environment, id,
        launchContext, launchType, modifiedBy, modifiedTimeStamp, name,
        resources, version

  rel              method  type / responseType
  self             GET     …compute.context
  alternate        GET     …compute.context.summary
  update           PUT     …compute.context → …compute.context
  updateWithRules  PUT     …compute.context.request → …compute.context
  delete           DELETE  —
  createSession    POST    …compute.session.request → …compute.session
  rules            GET     application/vnd.sas.collection
```

Four fields against twelve, and four relations against seven. The item is the
**summary** representation — its own `alternate` says so — and the three
relations it omits are inserted in the middle of the resource's list rather than
appended, so the summary is not a truncated prefix of the resource but a
different document.

Asking the resource for `application/json` instead answers `200` with the same
seven relations, so the difference is between *representations of different
resources*, not between media types on one.

What this does **not** distinguish, with one identity available: whether the
three missing relations are omitted because a summary omits administrative
relations by design, or because the set is computed against the caller. Both
readings survive the measurement. Either way the consequence for the code is the
same and is the point of the finding: **the link set on a collection item is not
the link set on the resource**, so "this relation was not in the response I
happened to read" cannot be turned into "this deployment does not offer this
operation".

### Finding 55 — `createSession` did not move

Eight reads of the unfiltered collection over roughly forty seconds, plus one
filtered read per context — `?filter=eq(name,'…')`, the exact request
`resolveContext` sends — is twenty-one responses covering thirteen contexts.
Every context carried `createSession` in every one of them, and every item
carried the identical four relations. `count` was `1` on each filtered read.

So the flicker recorded in 2a-iii **did not reproduce**, and nothing about the
request shape explains it: filtered and unfiltered agree, and repetition does
not perturb it. For a caller who may launch a context, the relation is stable.

### What this settles

1. **An absent relation is a statement about one response, not about the
   deployment.** Finding 54 gives the mechanism that is certain: the summary
   carries fewer relations than the resource, so one context answers two
   different link sets depending on which representation was read.

   The per-caller reading is **inferred and not measured**, and is recorded here
   as an inference. SAS's REST usage notes say two things separately — links
   "indicate actions, operations, or state transitions that the client can make",
   and authorization is evaluated per method per caller, so "an authenticated
   user can have authorization to read a resource via a GET method, but not have
   authorization to update or delete a resource via a PUT or a DELETE" — and
   reading a per-caller link set out of that pair is this project's inference
   from them rather than a claim SAS makes. It is plausible enough to act on and
   it is not confirmed; the experiment that would confirm it is listed below as
   not run. It also does not account for the case that prompted the probe:
   `createSession` was present on **both** representations, and the three the
   summary omits are `update`, `updateWithRules` and `rules`.

   What every reading forbids is the same, and that is the operational point:
   the deployment is the last thing to blame.
2. **The comment in `contexts.ts` was wrong and is corrected in this change.** It
   read the absence as meaning "the one-call design does not apply to this
   deployment". It means no such thing.
3. **The user-facing wording was wrong too.** `messages.ts` said "This SAS Viya
   deployment does not offer that operation here", which sends the reader to
   their administrator to ask about a deployment capability. It now says the
   operation was not offered *to this account on that resource*, which is what
   was observed and is also the actionable reading — pick another context, or ask
   for permission on this one.
4. **Finding 15 is unaffected.** The summary still carries a fully formed
   `createSession` link, so the one-call design stands; this finding narrows what
   its *absence* proves, not what its presence buys.

### What this probe did not settle

- **Why the 2a-iii connect failed.** Twenty-one reads did not reproduce it. The
  remaining candidates — an authorization decision cached and re-evaluated, a
  token refreshed mid-connect, or a transient in the Compute service — are not
  separable from outside, and the extension logs the response it acted on rather
  than the response body, so the next occurrence will not distinguish them
  either unless it is logged first.
- **The decisive experiment.** Reading the same context as a user who may *not*
  launch it would separate "summary omits administrative relations" from
  "the set is computed per caller". It needs a second Viya account with
  different entitlements, which this deployment did not offer to hand.
- **Whether `resolveContext` should stop treating absence as fatal.** Filed
  rather than fixed: see the 3a punch list. A retry, or handing the `POST` to the
  server and reporting its answer, is a behaviour change with tests attached and
  does not belong in a corrections change.
- **Viya 3.5.** Not probed, as ever. Whether its contexts collection is a summary
  in the same way is unknown.

## 2026-08-19 — The session listing, during the first live mutating run (Viya 4)

Not a probe in its own right. RUNBOOK **P40** exercises the live tier's three
gates now that one live test writes to a deployment, and its last step lists the
compute sessions before and after to prove the test cleans up after itself. The
shape of that listing came out of it, and it changed the procedure.

### Finding 56 — The session collection item carries no timestamp and no state

Measured 2026-08-19 on deployment A. `GET /compute/sessions?limit=100` with
`Accept: application/vnd.sas.collection+json` answered `count: 3`, three items,
and the items carried:

```
id, links, owner, version          (2 of 3)
id, links, owner, version, name    (1 of 3)
```

No `creationTimeStamp`, no `state`, no `attributes`. `name` is present only where
the session has one, and none of the three carried `python-on-viya` — the
constant this extension sends (`session.ts:105`) — which is what a baseline taken
before the test runs should look like.

**What it costs.** "Is anything of mine still running?" has exactly one
answerable form on this collection: compare ids against a listing taken *before*
the run. There is no timestamp to fall back on, and the name cannot discriminate
between runs because `SESSION_NAME` is a constant in `session.ts` — every session
this extension has ever started on a deployment carries the same one. P40 step 6
offered the timestamp as a second discriminator until this measurement removed
it.

**Why it is not a surprise.** This is finding 54's principle on a second
collection: the item is the summary representation. The session *resource*
plainly carries more — finding 24 measured the name echoed back from it, and
finding 18 read `attributes.sessionInactiveTimeout` off it — so the two
representations differ here the same way the context's two do.

**Not settled.** The exact field set of the session resource was never
enumerated the way finding 54 enumerated the context's, so "how many fields the
summary omits" is unquantified. Nothing currently needs the number.

## 2026-08-20 — What a fileref's links actually say (Viya 4)

Finding 36 established the fileref upload mechanism — seven relations, and a
`PUT …/content` that is `428 Precondition Required` without an `If-Match` and
`201` with the `ETag` from a `GET` of the fileref. It recorded neither the media
type any of those relations advertises nor the `name`/`path` values it sent, and
`src/compute/fileref.ts` had been written citing it for both. This probe was run
to close that gap before the module ships.

**Mutating.** Agreed with Sean beforehand. One compute session was created on
deployment A, five filerefs were assigned inside it, content was written and
read back, and the session was deleted at the end; the session listing was taken
before and after, per RUNBOOK **P40**. Nothing outside that session was touched.
Ids, hostnames and paths below are elided or synthetic except where the shape
itself is the finding.

### Finding 57 — The fileref's `upload` relation advertises `application/octet-stream` itself, and a bare relative `path` lands inside the session

`POST /compute/sessions/{id}/filerefs` with body `{"name":"case1",
"path":"case1"}` answered `201`. Below, `…` stands for the
`application/vnd.sas.` prefix, `→` separates a relation's request type from its
response type, and `—` means the relation carried neither:

```
  rel        method  type / responseType
  self       GET     …compute.fileref
  alternate  GET     …compute.fileref.summary
  deassign   DELETE  —
  content    GET     application/octet-stream
  upload     PUT     application/octet-stream
  append     POST    application/octet-stream
  delete     DELETE  —
```

and the session's own relation that creates them:

```
  assign     POST    …compute.fileref.request → …compute.fileref
```

**Why the types matter.** Four of the seven carry one, and the three
octet-stream ones are not SAS vendor types, so `computeMediaType` passes them
through untouched — a raw byte upload is never suffixed `+json`, and a content
`GET` asks for `octet-stream` rather than a vendor type it would be refused for
(finding 6). The consequence for the code is that `client.ts`'s **default** of
`application/octet-stream` for a `rawBody` request is not the arm taken on this
path: the link's own type is used, and happens to carry the same value. The two
were indistinguishable on the wire, which is exactly why the distinction had to
be measured rather than assumed.

**A bare relative `path` is session-scoped.** The response carried `filePath`
`…/compsrv/default/<session-uuid>/case1` — the session's own run directory. So
a fixed fileref name cannot collide between concurrent runs on one deployment,
and the file dies with the session: a live test that deletes only its session
leaks nothing. This is what makes `createFileref` sending the same value for
`name` and `path` defensible rather than arbitrary; finding 36 elided the values
it sent, so it established nothing about a divergent pair, and it still does
not.

**Round trips confirmed.** `PUT` with the `ETag` from a `GET` of the fileref,
then `GET …/content`, over four of the corpus's cases plus a genuinely empty
file: CRLF (34 B), UTF-8 multi-byte (22 B), no-trailing-newline (28 B) and the
0-byte case all came back md5-identical to what was sent. `PUT` with no
`If-Match` is still `428`, as finding 36 measured.

**The read-back `Content-Type` is sniffed, not echoed.** `GET …/content`
answered `text/plain` for the four non-empty cases and **`inode/x-empty`** for
the empty one, despite every one of them having been uploaded as
`application/octet-stream`. Neither is JSON, so `client.ts` leaves `body`
undefined and a caller reads `text` — which is the behaviour wanted, but it is
worth recording that the type on the way out says nothing about the type on the
way in.

**Also seen, and not recorded by finding 36:** the create response carries
`version: 2`, `isAggregation` and `isDirectory` alongside the `accessMethod`,
`fileName`, `filePath` and `fileSize` that finding did record.

### What this probe did not settle

- **A `404` from a fileref.** No fileref resource answered `404` in any request
  here, so nothing establishes whether a missing fileref and a missing session
  are distinguishable. `fileref.ts` reads both as `session-gone`, which is a
  reading and is documented as one in that module.
- **Whether `name` and `path` may diverge.** Only the matching pair was sent.
  The `filePath` measurement makes a *relative* `path` session-scoped; it says
  nothing about an absolute one, which was not attempted.
- **Whether the create response's `ETag` matches the `self` read's.** Not
  compared. `writeFilerefContent` issues the `GET` unconditionally rather than
  taking the shortcut `session.ts` takes on finding 21's evidence, and this
  probe gives no reason to change that.
- **Viya 3.5.** Not probed, as ever.


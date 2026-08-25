# Phase 2a — Compute session core & VS Code shell

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 2 — Compute session and the backend seam

**2a — HATEOAS Compute layer.** Link following, ETag handling, session creation
with context resolution, session reconnect, and **session-death handling**:
detect a reaped or expired session, tell the user plainly that state was lost,
and recover. *Amended 2026-08-14 during 2a-ii: "offer recovery" became "recover".
A dead session is found while the user is connecting, so the offer would be a
prompt whose answer is always yes; the loss is stated in the log and a new
session is started.* Split along the same seam 1b and 1c used, for the same
reason — the pure half is unit-testable and the shell half is not:

> **2a-i — the Compute core, no `vscode` import.** The link layer (find a
> relation, resolve its `href` against the deployment origin, derive
> `Content-Type`/`Accept` from its `type`/`responseType`), the `+json` media-type
> rule, the Viya error envelope as a problem union, a request helper on 1b's
> `https.request` transport carrying `If-Match` and `If-None-Match`, context
> resolution by name, and session create / poll / delete. Unit-tested against
> fixtures scrubbed from live probes. *Medium.*
>
> **2a-ii — the VS Code shell.** Binding a session to a profile and the
> authentication provider's token, reconnect across a window reload,
> session-death detection and its recovery message, progress reporting and
> cancellation, and the output channel. The session id is persisted in
> `workspaceState` keyed by profile id, one session per workspace and profile,
> and the stored id is treated as a hint validated by use rather than a fact —
> **ADR-0012**, which also records why reclaim-by-listing was rejected after the
> probes made it possible. Integration-tested, one test per shell module.
> *Medium.*
>
> **2a-iii — one account, one command.** *Added 2026-08-15, after 2a-ii merged and
> was used by hand.* Five defects in `src/auth`, none of which the suite caught.
> Connecting must ask VS Code for the **active profile's account** rather than
> accepting whichever it is handed and then refusing it — without that, a second
> profile could not be connected to at all, which foreclosed in practice the
> multi-profile capability 2a-ii built. The refusal survives as an assertion, for
> the one case an account cannot express: two profiles pointing at the same
> deployment share an account. On top of it: *Sign In* connects, so one command
> reaches a session — from the command, never from the provider, so that the
> polled Accounts menu cannot start a SAS process; the Accounts menu resolves
> profiles concurrently and bounds each answer, so one unreachable deployment
> does not stall it, while a caller that names an account — connecting does —
> still waits for that one; a cancelled sign-in is reported as
> a cancellation; and a session that is not restored says why — at debug when
> nobody was signed in, at information when one that was working has expired
> with nothing stored to renew it from. *Small.*

**The generated OpenAPI client is not vendored — see ADR-0010.** This reverses
what this plan pre-agreed. Upstream's client is 28,673 lines of which the session
layer calls twelve operations out of 136; its only transport is axios, which
ADR-0008 removed; and the wart this slice was going to fix,
`link.href.replace("/compute", "")` in `rest/common.ts`, exists *because* of the
vendoring — the service's own hrefs already carry the prefix that a generated
client's `basePath` adds a second time. Keeping the origin as the only stored
base deletes the wart's cause rather than patching its effect. Hand-writing the
used surface is 350–450 lines against 20,348.

**2-pre — Submission-mechanism probe.** *Not an implementation slice, and it must
run **before** 2b* — all three findings shape the interface 2b freezes, so probing
after it would be backwards. Settle and record in `PROBE-FINDINGS.md`:
(i) how user code containing `endsubmit;`, `%let`, and `&sysuserid` behaves when
inlined, and whether `proc python file="…"` (upload to the session filesystem) is
the injection-free submission path — *the option name in this question is wrong;
it is `INFILE=`, per the findings below*; (ii) whether `SYSCC` is readable from
`GET /compute/sessions/{id}/variables/SYSCC` rather than only from log text — if
not, 3a's failure detection depends on 3b and they must merge or reorder;
(iii) how to reset the Python namespace **without** destroying the compute session
— `reset()` and the cancellation fallback both depend on the answer.

> **Run 2026-08-16 against Viya 4 — findings 31–39.** (i) **Upload plus
> `proc python infile=<fileref>;`** is the mechanism. A bare `endsubmit;` inside a
> triple-quoted string ends the block, and the truncated remainder poisons the
> tokeniser so that the *next* job reports `completed` while executing nothing —
> a silent wrong answer rather than an error. Inside an intact block, `%let` and
> `&sysuserid` are literal text and an apostrophe opens nothing, so inlining fails
> in exactly one way, and that way is unacceptable. The option is `INFILE=`, not
> `FILE=`; `PUT …/filerefs/{ref}/content` needs `If-Match` or returns `428`.
> (ii) **`SYSCC` is readable** from the variables endpoint (`1012` for an uncaught
> Python exception, `3000` for a SAS syntax error), so **3a does not depend on 3b**
> and the order below stands. It reset to `0` per job unprompted, but whether that
> is contractual is unsettled — do not rely on it. (iii) **`proc python restart;`**
> clears the interpreter in ~3.4 s without touching the session, and composes with
> `infile=` in one statement, so `reset()` keeps its planned shape.
>
> **What this hands 2b:** the interface must express *upload a file, then run it*,
> not merely *submit a string*. Freezing a `submit(code)` seam would freeze the
> wrong one. **Recorded as ADR-0014**, with the rejected alternatives — including
> the tempting one, sending the recovery incantation before every inline
> submission — and the six things findings 31–39 did not settle.

**2b — `ExecutionBackend` interface + dialect layer.** Define the interface (§2.2)
**per ADR-0014** — the submission method expresses *upload these bytes, then run
that file*, and `submit(code: string)` is foreclosed — including the **busy/queue
contract** and `freshNamespace` semantics, `Dialect`
base with Viya 4 and 3.5 subclasses, `resolve()` with an alias registry, and
**stage-1 (HTTP-derived) capability probing only** (§2.3). Land a **minimal
`contracts/` file and checker here** and grow it per slice — contracts are built
alongside the dialect code, not retrofitted in Phase 5. No execution yet: this
slice is pure structure and its unit tests are the specification. *Medium.*

> **Split 2026-08-16 into 2b-i and 2b-ii**, along a settled/unsettled seam rather
> than the usual pure/shell one. 2b-i is the interface, the dialects and
> `resolve()` — shapes ADR-0014 and the 2-pre findings had already decided, now
> recorded as ADR-0015 and specified by a contract test suite driving a test
> double. 2b-ii is `contracts/`, its checker and stage-1 probing, where the file
> format still has to be chosen. `RUNBOOK.md` carries the reasoning and the two
> gaps 2b-ii inherits.

**2c — Log streaming.** Port the long-poll `getLogStream` async generators
(server-side `timeout: 10` long-poll, monotonic `start` cursor, then drain via the
`next` link to catch lines written after terminal state) and ETag state polling.
Fix the two self-recursion warts that live here, not in 2a: the uncached-state 304
recursion in `rest/job.ts::getState`, and the 412 recursion in
`rest/session.ts::cancel()` — the latter matters because 3d-i's Cancel rides on it.
*Medium.*

> **Measured 2026-08-17 by 2c-pre**, findings 46–53. The mechanics above survive
> with four corrections, but the *shape* named above does not — see the fifth:
> - **The log has no ETag.** Its cursor is `start` alone and `If-None-Match` has
>   nothing to send, so "ETag state polling" above can only mean the *job state*
>   resource (finding 28). Two long polls with two different mechanisms, not one
>   mechanism used twice.
> - **`timeout` is not optional.** It long-polls for real: against a job silent
>   for 25 s, `timeout=10` blocked the full 10.27 s while the same request
>   without it came back empty in 0.56 s; against a job printing a line a
>   second, `timeout=10` released in about 1.0 s each time. The parameter is the
>   only thing between this loop and a busy-wait, so it belongs at the call site
>   rather than in an options bag a caller can leave out.
> - **Expiry is `200` with `items: []`,** never `304` — where the session
>   state's expiry, the only other one measured, is a `304` (finding 28). The
>   job state's expiry has never been observed.
> - **The drain is free.** A terminal job short-circuits the wait (0.26 s), so
>   there is no trailing ten-second stall and the loop can afford to keep
>   reading until `next` is absent. `next` disappears even on a *full* final
>   page, so the terminator is the link's absence and never a short page.
> - **"Port the async generators" is wrong**, and this is the larger correction.
>   ADR-0017 rejects `async function*` outright: a generator does not poll until
>   somebody iterates, so an unconsumed stream never runs and its `done` never
>   settles, which is exactly what ADR-0015's no-stall clause forbids. 2c writes
>   a self-driving pump instead.
>
> The mechanics also make a cheaper loop available: long-poll the log, and ask
> the job state for a verdict only when a poll returns empty *quickly* — during
> a live but silent stretch the poll blocks its full window, so a fast empty
> page is a usable hint that the job has finished. A hint only: the probe
> measured terminal-implies-fast once and never the converse, so the state
> resource keeps the final say. One state request per quiet interval instead of
> one per iteration.
>
> All of it, plus the stream's shape, is
> [ADR-0017](docs/adr/0017-the-log-stream-is-a-self-driving-pump.md): the
> outputs are a **self-driving pump** behind ADR-0015's `AsyncIterable`, not an
> `async function*`, because a generator does not poll until somebody iterates
> and a caller awaiting `done` while ignoring `outputs` is a caller that
> deadlocks. The ADR leaves one policy question to 2c on purpose: an unconsumed
> pump accumulates lines, and what to do about that — cap or no cap, which end
> is dropped, whether an overflow is reported — is the slice's to decide. 2c is
> otherwise an implementation slice.

> **Split 2026-08-17 into 2c-i and 2c-ii**, along the line the probe itself drew.
> Everything findings 46–53 settled about a *single request* is 2c-i — job
> creation, job-state reading, the five-member terminal set, and the stateless
> single-page log reader — and everything they settled about a *loop* is 2c-ii:
> the poll, the drain, the `AsyncIterable`, the buffer and cancellation. The log
> reader belongs with the first half rather than the second because `session.ts`
> established that every function in these modules makes exactly one request and
> reports what happened; holding one back for the slice that loops over it would
> make it the first exception to that rule, and it would arrive untested.
>
> The policy question the ADR left open is answered, and it is 2c-ii's to build:
> **cap the buffer, drop the oldest lines, and report the dropped count to the
> consumer.** The cap is set high enough that no ordinary program reaches it; the
> oldest go first because a runaway loop's failure is in its last lines, not its
> first; and the count is surfaced because a log with a hole in it and no marker
> is a log that lies.

> **2c-ii built it, 2026-08-18, and settled the policy question in two places the
> paragraph above left as one.** The cap is on **lines and characters, whichever
> is reached first** — a hundred thousand short lines and one enormous line are
> the same hazard to the extension host, and a line cap alone catches only the
> first of them. Characters are counted as `String.length`, UTF-16 code units,
> deliberately not `Buffer.byteLength`: the number is a memory ceiling budgeted
> at about two bytes each, and paying for exactness would put a Node global into
> a module that has no other reason to have one.
>
> The overflow is reported **twice, not once**. "Report the dropped count to the
> consumer" assumed there was one consumer; ADR-0015 gives the handle two halves
> and they fail differently. A caller reading the stream needs to know *where*
> the hole is, so the loss arrives in band as a marker sitting at the hole; a
> caller that only awaits completion never sees the stream at all, so the total
> also rides on the settled outcome. Either report on its own leaves one of the
> two blind to a truncated log.
>
> Two things in this section's file tree are now stale and are left as written,
> since the tree is the *proposed* layout rather than a record: the code landed
> under `src/compute/` rather than `src/connection/rest/`, and the log stream is
> its own module, `src/compute/logStream.ts`, rather than part of `job.ts`.
> Splitting it is what let 2c divide into a slice with no concurrency in it and a
> slice that is nothing but concurrency, and the seam between them caught a
> cursor-desync defect under review before anything leaned on it.
>
> One thing this section claimed about the tooling was wrong and is corrected in
> `RUNBOOK.md` and ADR-0017: the contract checker does **not** catch an endpoint
> the code calls but `contracts/*.yaml` omits. Nothing in it reads the client
> code. Keeping §2.3's inventory honest is a person's job, done in the pull
> request that adds the call.

*Exit:* can open a compute session against a real Viya, stream its log, reconnect,
survive session death gracefully, and report stage-1 capabilities — all covered by
mocked-HTTP unit tests.


---

## Runbook

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

☑ **2a-ii punch list. Closed 2026-08-19.** Eleven of the twelve items below are
done. The twelfth — refusing to submit into a busy session — was moved out
of this slice on 2026-08-14 because it has no caller until something submits,
and it is now carried by the 3a punch list rather than by an open box here. A
slice held open by one item that is deliberately not in it reads as unfinished
work and hides the eleven that are.

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

  **Re-listed in the 3a punch list on 2026-08-19.** "Moved to 3a" had been
  written here and nowhere else for five days, which is not a destination — it
  is an item that leaves one list without joining another. It stays ☐ here as
  the record of where it came from; the copy in Phase 3 is the one that gets
  worked.
- ☑ **Poll the *job* for completion, never the session.** Finding 27 measured the
  job reaching `completed` two to three seconds before the session returned to
  `idle`. Use the job's `state` link, and send `wait` **and** `If-None-Match`
  together — finding 28 measured `wait` alone returning immediately, which would
  turn the poll into a hot spin that still looks correct.

  **Moved to 3a on 2026-08-14, unstarted**, for the same reason as the item
  above: there is no job to poll until something submits one. The *session*
  long poll it is contrasted with did land in 2a-i (`waitWhilePending`), so the
  mechanism is built and tested; what moves is only the choice of resource.

  **Settled in 2c-i on 2026-08-17, and not in 3a.** The resource choice landed
  with `src/compute/job.ts`: `readJobState` follows the job's own `state` link
  and nothing polls the session for completion, which is the whole of what this
  item asked for. What did *not* land is the mechanism inside it — there is no
  state long poll at all. `?wait=` is inert on a state resource without an
  `If-None-Match` to validate against, the job state resource was never observed
  to carry an ETag, and 2c-pre found the *log* endpoint's `timeout=` really does
  long-poll, so completion is observed by draining the log rather than by
  watching the state. The item's prescription is superseded; its instruction is
  met. `job.ts:68` says the same thing at the code.
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

Not fixed, because it was not understood: the *same* context started a session
two minutes later without complaint. Filed as probe task #135 — if a context's
link set depends on the token presented, `contexts.ts` is wrong to read an
absent `createSession` as a permanent property of the deployment, and the
message it writes is misleading.

**#135 was probed on 2026-08-19 and the misleading half is now fixed**
(findings 54 and 55). The inference was indeed wrong, and for a reason nothing
to do with tokens: the collection item the picker reads is the *summary*
representation, and the resource it points at carries three relations the
summary never does — four fields and four relations against twelve and seven,
measured on the same context minutes apart. An absent relation therefore
describes the response in hand, not the deployment. The comment in
`contexts.ts`, the log fragment in `problems.ts` and the notification in
`messages.ts` all said or implied otherwise and were corrected in the same
change, along with `docs/connecting.md`.

The flicker itself is **not** explained and is not being chased further:
twenty-one reads across thirteen contexts never lost the relation, so it is not
the request shape, and the surviving candidates — an authorization decision
re-evaluated, a token refreshed mid-connect, a Compute transient — cannot be
separated from outside. What is left of #135 is a *behaviour* question — whether
`resolveContext` should fail at all rather than let the `POST` be refused by the
server — and that carries tests, so it goes to the 3a punch list rather than
here.

Step 3 is **unconfirmed rather than failed**: `settings.json` showed no
`context` after what looked like a successful connect, but the run never
established whether the picker appeared, and #84 means the connect may not have
been acting on the profile being inspected. Re-check it after #84 lands before
concluding anything about the write-back.

> ☐ **#84 landed, so this re-check is now owed. 2026-08-19.** The condition it
> was waiting on was met in the 2a-iii punch list above, and the item then sat
> here for four days as a sentence rather than as a step — which is the failure
> this whole restructure is about. It is one connect:
>
> 1. Pick a profile with **no** `context` in `settings.json`, and confirm the
>    setting is genuinely absent rather than empty.
>    **Expected:** nothing yet; this is the precondition.
> 2. Run **Python on Viya: Connect to SAS Viya** and answer the context picker.
>    **Expected:** the picker appears, and the connect succeeds on the context
>    you chose.
> 3. Re-read `settings.json`.
>    **Expected:** `context` now holds the name you picked, on the profile you
>    connected with and on no other.
>
> If the picker does not appear at step 2, the write-back is not what failed and
> the finding is a different one — say which of the two happened, because the
> original run could not.

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

☑ **2a-iii punch list. Complete; header ticked 2026-08-19.** All six items below
were ☑ and the header was not, which by the legend at the top of this file reads
as "unrecorded" rather than "not done" — and it is the reading that costs
something, because an open punch list on the last slice of a phase is the first
thing anyone checks before starting the next one. The paragraph below says
*five* and is left as it was written: the slice was scoped at five defects and
grew a sixth, #137, out of the manual run on 2026-08-15.

Five defects, every one of them found by using the
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

☑ **P35 — what the one Accounts row actually means. Run by hand 2026-08-19,
against two live Viya 4 deployments.** A separate run with its own steps, written
up here rather than further down because everything it settles belongs next to
#146 and #147 above; the 2a-iii procedure itself resumes after it. #146 left two
explanations standing and only one of them makes #138 necessary, so it was worth
a procedure of its own. Both are now settled, and the run turned up a third thing
neither question asked about.

The run, step by step, with what each one produced. The two deployments are **A**
and **B** throughout — their addresses are not written down anywhere in this
repository.

1. **Two reachable deployments, as two profiles.** Confirmed: two, both working.
2. **Log level to Debug**, as the preamble below describes. Answered
   "confirmed" at the time, and the channel says otherwise — see *the step that
   passed without doing anything* below.
3. **Switch to profile B, then Sign In.** Signed in — but the browser prompted
   **twice**, which is the third finding at the end of this entry. The connect
   that followed logged the previous session having ended, then
   `Started a SAS Viya session on compute context "Data Mining compute context".`
   and `SAS Viya version: the deployment reports Viya 4 2026.06 (Stable 2026.06).`
4. **Switch back to profile A, then Sign In.** Prompted **once**.
5. **Open the Accounts menu.** Exactly **one** row, reading exactly
   `Sean Ford (SAS Viya)`. Checked at every step of the run, and never more than
   one row at any point.
6. **Read the log for a dropped profile.** No such lines — read at `info`,
   where a `debug` line could not have appeared at all. This step proved
   nothing; step 7 is what settles #146.
7. **Sign Out from that one row.** Two `Signed out of …` lines, naming **both**
   deployments, followed by three `no stored sign-in for …` debug lines — more
   than one per profile, which is the list being re-resolved more than once as
   the sign-out publishes and the menu polls. What matters is that every one of
   them says a profile has no stored sign-in left.
8. **Re-open the Accounts menu.** No rows.

**#146 is the label, not the budget — and that is the answer that costs us
something.** Step 7 settles it on its own, which is just as well, because step 6
turned out not to be evidence. One row was signed out of, and the channel
recorded `Signed out of …` **twice**, four milliseconds apart, naming both
deployments — followed by three `no stored sign-in for …` lines and an empty
menu. Had the resolve budget dropped a profile, the host would have been holding
one session, and signing out of the one row it drew would have written **one**
line. Two lines means the host held two sessions and drew them as one row. So
the host groups the menu by `account.label`, which `accountLabel()` derives from
the person — one person on two deployments is one label — and `accountId()`'s
per-deployment keying, which is correct and unchanged, is simply not what the
menu keys on.

**Which decides #138.** The 2026-08-16 entry above said to settle this before
#138 precisely because grouping by label would mean "signing out of that row
signs you out of both", and that is what step 7 observed. The Accounts menu
therefore **cannot** express signing out of one deployment while staying signed
in to the other, and #138 has to supply its own per-deployment sign-out rather
than lean on the menu. **#147** was re-observed at every step and compounds it:
the row names the person and "SAS Viya" and never names this extension, so one
row standing for two deployments reads as one deployment.

**A support track the earlier runs had not exercised.** B reported
`Viya 4 2026.06 (Stable 2026.06)` where A reports `2026.03 (Long-Term Support
2026.03)` — a different cadence *and* a different track, through the same
`cadenceDisplayName` path, which until this run had only ever been seen on
long-term support.

**And the one neither question asked about: Sign In prompted for the browser
twice.** It turned out to be #146 a second time, in a place that costs more than
a menu row. Step 3 logged `Signed in to …` for B at 06:04:44.917 and again
at 06:04:55.784 — 10.9 seconds apart, same endpoint — and the browser login was
completed twice by hand. That line is written at the end of `signInWithBrowser`
(`src/auth/browserFlow.ts:188`), after the code exchange and the token write, so
each of the two is a *completed sign-in*, not a consent dialog.

**Step 4 is not a contrast, though it was written up as one.** Signing in on A
prompted once, and the reason is not that the account hint was found: A's connect
never reached the auth path at all. `runConnect` returns the connection the
manager is already holding for the active profile before it asks for anything
(`src/compute/sessionManager.ts:342-343`), and A's session had been running since
05:58:40 and survived the excursion to B — which is #141, above, still holding.
The channel proves the early return: `Signed in to …` at 06:07:15.198 is followed
by **no** `Started`, no `Reconnected` and no version line, where step 3's sign-in
was followed by all three. So this run contains exactly **one** observation of
the double prompt and nothing to compare it against.

How the second one is reached is settled; why is not. `signIn` calls
`provider.createSession()` and then `deps.connect()`
(`src/auth/commands.ts:124-131`), and `runConnect` has no way to know a sign-in
has just happened: it asks `accountFor(profile)`
(`src/compute/sessionManager.ts:350`, `:831-838`) and, on `undefined`, asks for
`{kind: "new"}`, which becomes
`{forceNewSession: true, clearSessionPreference: true}`
(`src/auth/sessionRequest.ts:107`). **`forceNewSession` opens the browser
unconditionally**, valid session or not. So the second prompt follows from
`accountFor` returning `undefined` for a deployment signed in to a moment
earlier. **P35a says why.**

☑ **P35a — the same sign-in with the log at Debug from the first line, and the
other deployment signed out. Run 2026-08-19, 07:24 to 07:27.** A fresh dev host
(so no session is held and the early return above cannot hide anything), the
level set to Debug and *proved* to be set, profile B made active with
**Disconnect from SAS Viya** confirmed missing from the palette, then **Sign In**.

**The double prompt did not reproduce.** One browser login, one `Signed in to B.`
at 07:27:12.835, then the connect ran straight through to
`Started a SAS Viya session on compute context "Data Mining compute context".`
and the 2026.06 version line. Every `[debug]` line in the run — ten of them —
reads `no stored sign-in for A`, and **not one** names B. So B was resolvable
throughout, and no profile was ever dropped for time.

**One thing differed between the two runs, and it is the whole answer: in P35, A
was signed in as well.** `getAccounts` de-duplicates accounts **by
`account.label`**, which is confirmed in upstream `AuthenticationService`
(`src/vs/workbench/services/authentication/browser/authenticationService.ts`):
it asks the provider for every session and then keeps a session's account only
`if (!seenAccounts.has(session.account.label))`. So one person signed in to two
deployments produces **one** account in the answer — the first session in our
list, which follows profile order — and the second is discarded. `accountFor(B)`
then hands `accountForEndpoint` a list containing only A's account, gets no id
starting with B's root, and answers `undefined`. `runConnect` reads that as
"nothing is signed in to this deployment", asks for `{kind: "new"}`, and
`forceNewSession` opens the browser on a deployment signed in to eleven seconds
earlier. P35a signed A out first, which left one account, which is why it
prompted once.

Read on upstream `main` rather than on the 1.104 floor this extension targets, so
what the record rests on is the two runs; the source says why they differ. The
same file shows the host keying access grants and the account preference on the
label too — `isAccessAllowed(providerId, session.account.label, …)` and
`_getAccountPreference` matching `session.account.label` — so **the label is the
host's account key throughout, and `account.id` is ours alone.**

**Which is why #146 is not cosmetic, and this is the part to carry into
Phase 3.** One label collision costs three things, not one: the Accounts menu
collapses to a row that signs you out of both (#146, #138); the #84 account hint
silently stops working for **every deployment after the first**, which is the
mechanism #137 exists to protect; and because the missing hint routes into
`forceNewSession` rather than a picker, the user pays for it with a whole extra
browser round trip instead of a wrong-looking list.

**The candidate fix, deliberately not taken here.** `accountLabel()` is one
function (`src/auth/identity.ts:202`), and a label that distinguished the
deployment would give two rows, a working hint, a per-deployment sign-out and a
row that says which Viya it is — #146, #147, #138 and this, together. Against it:
decision 10 chose person-only on purpose, and the label is the string the user
reads. It wants an ADR amendment rather than a quiet change, and #138's design
should be written against whichever way that goes.

**Filed as issue #42**, opened 2026-08-19, carrying both runs, the upstream
quotation and the three costs. It is an issue rather than a punch-list item
because it outlives this slice: the decision it asks for is an ADR amendment, and
#138 cannot be designed until that decision is made. Punch-list numbers are
written there without a `#`, because inside a GitHub issue `#146` reads as a
reference to issue 146 — a number this repository will reach.

**The resolve budget was ruled out twice, and the arithmetic is worth keeping**
because it is the argument that did not need a second run. `accountFor` reaches
`getAccounts` → `getSessions(undefined)` → `allSessions(undefined)`, in which
every profile is bounded by `RESOLVE_BUDGET_MS` — 10 000 ms — since none is named
as `unbounded` (`src/auth/authProvider.ts:336-362`). But P35's two sign-ins are
**10.867 s** apart, and between them sit the identity fetch of `establish`, a
publish, the account lookup, the browser opening, **a human completing a login**
and the code exchange. One arm spending its full budget is 10.000 s on its own,
leaving 0.867 s for all the rest including the human. P35a then confirmed it from
the log: no drop line, for either profile.

**And one about how a hand-run step fails — *the step that passed without doing
anything*.** Step 2 sets the log level to Debug, and was answered "confirmed",
but the channel contains **no** `[debug]` line before 06:10:16 — the sign-outs of
step 7. That is not "nothing debug-worthy happened": the resolutions during the
P39 run recorded above would each have written `no stored sign-in for …` for the
profile not yet signed in to. So the level changed somewhere between steps 5 and
7, and every earlier step ran at `info`. Step 6 was the casualty, and #146 would
have been settled on evidence that could not exist had step 7 not been
independent of it. The rule this adds to the one 2b-ii already records: **a step
that changes how the log behaves must be verified by a line that behaviour
produces** — here, "run any command and confirm a `[debug]` line appears" — and
not by the operator agreeing that the setting was chosen.

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

**Half of it observed 2026-08-19; the timing was not.** The first connect of the
P39 run recorded under 2b-ii below landed on exactly this path — a binding stored
from an earlier window, whose session had been reaped in between — and logged
`The previous SAS Viya session has ended, so a new one will be started. Anything
defined in it is gone.` at `info`, then a `Started` line seven seconds later,
with no error dialog. So the *handling* is confirmed and the *interval* is not:
that earlier connect was never timed, and finding 18 remains the only evidence
that the reaper fires at 900 idle seconds. The sixteen-minute step above is what
would close the other half, and it stays optional.

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
ever built. And #135 has a half that is still open: a compute context whose
`createSession` link comes and goes. Findings 54 and 55 settled what the absence
*means* — it describes one response to one account, not the deployment — but
never reproduced the flicker, so if a context you pick in step 3 fails to start
a session and then works, that is the one, and it is worth capturing the
**Python on Viya** log at the moment it happens rather than afterwards. The
picker is reachable again either way, because the write-back happens after
success rather than before.

> **⚠ 2-pre is a probe, and it gates the interface 2b freezes.** Do not skip it,
> and do not run it after 2b — that would be backwards.

☑ **2-pre — run 2026-08-16 against Viya 4, written up as findings 31–39.** Using
the `viya-api-probe` skill and `creds.json`, settle three things and record them
in `PROBE-FINDINGS.md`:

1. **Injection.** Submit Python containing `endsubmit;` in a string, plus `%let`
   and `&sysuserid`. Does the block terminate early? Does SAS macro resolution
   fire? Then test `proc python file="…"` (upload the code to the session
   filesystem) as the injection-free alternative. *The option name in this
   question is wrong — it is `INFILE=`; see answer 1 below.*
2. **Failure signal.** Is `SYSCC` readable from
   `GET /compute/sessions/{id}/variables/SYSCC`, or only from log text? **If only
   from log text, 3a depends on 3b** and the two must be reordered or merged.
3. **Reset.** How is the Python namespace cleared *without* destroying the compute
   session? If the only way is killing the session, `reset()` and the cancellation
   fallback both need redesigning — which is exactly why this runs before 2b.

**The three answers, and what each one settles.**

1. **Inline submission is out; upload plus `infile=` is in.** A line reading
   `endsubmit;` inside a triple-quoted Python string **does** end the block —
   SAS finds the statement before Python ever sees the string. Nothing else in an
   *intact* block misbehaves: `%let` and `&sysuserid` pass through as literal text
   and an apostrophe does not open a SAS quote, so the danger is narrower than
   feared but it is real, and it is worse than a syntax error. The truncated
   block leaves the tokeniser poisoned, and **the next job in that session reports
   `completed` while executing nothing at all** — a silent wrong answer, not a
   failure. The option is `INFILE=`, not `FILE=` (SAS enumerates the real list in
   `ERROR 22-322`); `proc python infile=<fileref>;` runs an uploaded file
   byte-for-byte with no source echo and no tokenising of its contents. Uploading
   via `PUT /compute/sessions/{id}/filerefs/{ref}/content` requires `If-Match`
   from a prior `GET` — without it, `428`.
2. **`SYSCC` is readable as a session variable**, so **3a does not depend on 3b
   and the slice order stands.** `GET /compute/sessions/{id}/variables/SYSCC`
   returned `1012` for an uncaught Python exception and `3000` for a SAS syntax
   error, and it reset to `0` at the start of the next job without being told to.
   Whether that per-job reset is contractual is *not* settled — write the code so
   it does not matter.
3. **`proc python restart;` clears the interpreter without touching the compute
   session**, in about 3.4 s, and composes into one statement with `infile=`. So
   `reset()` keeps its shape: the libraries, filerefs and SAS-side state survive,
   and only the Python namespace goes.

Consequence for 2b: the backend interface must be able to express *upload then
run a file*, not just *send a string*. A `submit(code: string)` seam that assumes
inline text would be frozen wrong. All of this is **ADR-0014** — read it before
writing 2b, because it also lists what the probe did *not* settle, and two of
those (`TIMEOUT` for Cancel, `SRC` as a second hand-over path) are worth probing
before 3a designs around their absence.

> **2b split into 2b-i and 2b-ii, 2026-08-16.** Not the pure-core / shell seam
> the earlier splits used — both halves are pure — but a *settled versus
> unsettled* one. 2b-i is the interface, the dialects and `resolve()`: shapes
> ADR-0014 and the 2-pre findings have already decided, which can be specified by
> their tests and reviewed as a whole. 2b-ii is `contracts/`, its checker and
> stage-1 probing: a file format that has to be chosen, a second gate script, and
> the first code in this phase that asks a deployment a question. Together they
> would have made one pull request in which the settled half is unreviewable
> because the unsettled half is where all the argument is.
>
> **The seam is [ADR-0015](docs/adr/0015-the-execution-backend-seam.md)**,
> written and accepted before the code. Read it with ADR-0014: it decides opaque
> bytes over a code string, a streaming handle over an aggregate return,
> reject-when-busy over a queue, and a failure vocabulary of the seam's own — and
> it lists what it does *not* settle, which is most of what 3a through 3e will
> ask.
>
> ☑ Two known gaps 2b-ii inherited, **both closed 2026-08-17 in 2b-ii**:
> `contracts/` is now in the SCAN list in `scripts/check-copyright.mjs` (which
> needed a `#`-comment extractor arm as well as the directory — YAML is the first
> scanned language whose comment marker is not `//`), and in `.vscodeignore`,
> which is allow-by-default, so a new top-level directory ships inside the VSIX
> unless it is named there.

> **2b-i done 2026-08-16** (PR #28). Recorded 2026-08-19: 2b-ii has had the
> paragraph below since the day it merged and 2b-i had nothing, which made the
> only slice in Phase 2 with no completion record the one that defines the seam
> every Phase 3 slice implements.
>
> `src/backend/backend.ts`, `collect.ts` and `problems.ts`; the dialect layer as
> `src/dialects/dialect.ts`, `resolve.ts`, `viya4.ts` and `viya35.ts`;
> `test/helpers/fake-backend.ts` as the double; and `docs/architecture/`
> gaining `execution-backends.md` and `dialects.md`. ADR-0009's coverage-scope
> checker grew its `src/`-side arm in the same change. Two things carry forward
> into 3a:
>
> - **`test/unit/backend-contract.test.ts` is the seam's evidence, and it is
>   ADR-0015 clause by clause.** Its header states the intent plainly: nothing
>   implements the seam until 3a, so without that file the interface would sit
>   for two slices with no evidence its clauses are consistent with each other.
> - **It says 3a's backend "should be able to run this same file", and as
>   written it cannot.** All twenty-three cases construct `createFakeBackend()`
>   directly; there is no factory parameter and no exported suite. Making that
>   sentence true is a refactor, and it is on the 3a punch list rather than left
>   as a surprise for whoever starts 3a expecting a reusable suite.

> **2b-ii done 2026-08-17.** `contracts/viya4.yaml` and `contracts/viya35.yaml`,
> `scripts/check-contracts.mjs` wired into `verify`, and stage-1 probing in
> `src/dialects/probe.ts` called from `ComputeSessionManager.hold()`. The format
> decision is [ADR-0016](docs/adr/0016-api-contracts-are-checked-yaml.md); the
> two new pages are `docs/architecture/contracts.md` and
> `docs/architecture/capability-probing.md`. Four things worth carrying forward:
>
> - **The checker asserts in both directions**, so it fails on a contract listing
>   an endpoint the code does not call *and* on code calling one the contract does
>   not list. A one-directional check is a list that only ever grows.
> - **The `DialectId` union is parsed out of the source, not imported**, because
>   `check:contracts` runs before `build` and a gate that needs the thing it is
>   gating to compile first is a gate that stops running the day compilation
>   breaks. The parse fails loudly if the union stops being string literals.
> - **A three-way signal, not a missing string.** Finding 42 is the reason: an
>   unrouted path is answered by the ingress with a bodyless `404`, and so is a
>   proxy or a VPN portal. Only *"Viya answered and there is no cadence"* means
>   3.5; *"we could not ask"* means nothing, and resolves fail-soft to Viya 4 with
>   the log line's **level** carrying the certainty.
> - **The probe runs after a session exists**, which is why it lives in `hold()`
>   rather than at connect: a live session is what makes a Viya-shaped 404 a
>   statement about the endpoint rather than about the network.
>
> Still true and still worth saying: **no Viya 3.5 has ever been reachable from
> this project.** If a real 3.5 answers `/deploymentData` the way an unrouted path
> does, the probe says `unreadable` and Viya 4 is assumed — and there is no
> profile setting yet letting a user assert `viya35` by hand. That setting is the
> obvious next move if a 3.5 deployment ever appears.

☑ **P39 — the stage-1 probe confirmed by hand, 2026-08-19, against Viya 4.**
Findings 40–45 read the cadence resource with `curl`. Nothing had ever confirmed
the same two-request navigation through `ComputeClient` — with our bearer token,
our `Accept` headers and the media-type-qualified relation lookup — which is what
the log line reports. It does:

1. `F5` (*Run Extension*), then **Python on Viya: Show Log**. The channel opens
   at `Python on Viya activated.` and carries no version line.
2. **Python on Viya: Connect to SAS Viya**. Logged `SAS Viya version: the
   deployment reports Viya 4 2026.03 (Long-Term Support 2026.03).` The **level**
   is the certainty, so `info` here says the generation was determined rather
   than assumed, and the parenthetical is `cadenceDisplayName` — the support
   track — rather than a second version number.
3. **Disconnect**, then **Connect**. A new `Started` line and **no** second
   version line: the resolution is cached per profile for the life of the
   window, and `disconnect` clears the connection and the binding but not that
   cache.
4. **Developer: Reload Window**, then **Connect**. The version line returns,
   identical. The cache is a field on the manager, so a reload re-probes.

**Two things the run corrected, both in the paperwork rather than in the code.**
The Phase 2 review's item 39 said every connect writes a version line. It does
not: `generationFor` returns from the cache before it reaches the log call, so
the line appears on the first connect for a profile in a window, on any connect
after that profile's endpoint changes, and on every connect following an
inconclusive answer — because only `certain` resolutions are cached. And the
first draft of step 4 expected `Reconnected to the SAS Viya session for this
folder.`, which cannot happen here: step 3 disconnects, which deletes the session
and clears the binding, leaving nothing to reattach to.

**And one about how a hand-run step fails.** In the first attempt at step 3 the
Disconnect ran and the Connect did not, which produced a log matching the
expectation — no second version line — for the wrong reason. The tell was not in
the result but in the transcript: a successful connect always writes a `Started`
or a `Reconnected` line, and neither was there. A step whose expectation is an
**absence** has to name the line that proves the step happened at all.

> **⚠ 2c-pre is a probe, and it decides what drives 2c's loop.** Same reason
> 2-pre ran before 2b: the alternative is porting upstream's loop on the
> assumption that its `timeout` parameter does something, and finding out
> otherwise from a user's network.

☑ **2c-pre — run 2026-08-17 against Viya 4, written up as findings 46–53.** Four
questions, none of them answerable without creating a job:

1. **Does the log endpoint's `timeout=` actually long-poll?** If not, upstream's
   `while` loop is a hot spin throttled only by latency and 2c must drive from
   the job-state long poll (finding 28) instead — not the session's, which
   finding 27 already ruled out as two to three seconds late.
2. **What does a job representation look like**, and does it carry the links 2c
   needs — the open question finding 21 left.
3. **How does the drain terminate** — paging past the end, when `next` appears,
   and whether the log survives the job reaching a terminal state.
4. **What is the `type` vocabulary**, since 3b's filter is built on it.

**The four answers.**

1. **It long-polls, so the loop is driven by the log.** Two runs. Against a job
   deliberately silent for 25 s, `timeout=10` blocked the full 10.27 s and
   returned nothing, where the same request without `timeout` came back empty in
   0.56 s. Against a job printing one line a second, `timeout=10` released in
   about 1.0 s each time — the moment the next line appeared, not ten seconds
   later. Expiry
   is `200` with `items: []`, never `304` — where the session state's expiry, the
   only other one measured, is a `304` (finding 28). And **the log carries no
   ETag at all**, so `start` is the entire cursor and there is no
   `If-None-Match` machinery here at all — both state resources have an ETag and
   take a conditional request; the log has neither.
2. **Six fields and ten relations**, including `log`, `logAsText`, `listing`,
   `results`, `cancel` and `delete`. Two of them matter to code: `cancel` and
   `delete` carry **`type: null`**, which a contract typing the media type as a
   required string would reject; and `log` and `logAsText` are the *same href*,
   distinguished only by `rel` and the `Accept` you send.
3. **Drain until `next` is absent, and it costs nothing.** A terminal job
   short-circuits the wait — 0.26 s, not 10 — so there is no trailing stall at
   the end of an execution. Reading past the end is a `200` with zero items, not
   a `416`. `next` vanishes even on a *full* final page, so the terminator is the
   link's absence and never a short page.
4. **Four types observed — `source`, `note`, `normal`, `error` — and the set is
   open.** `note` is a catch-all covering continuation lines, whitespace and
   blank lines, not a `NOTE:` prefix test; `normal` is the user's own output and
   the rarest thing in the log. An unrecognised type must pass through rather
   than be discarded. The `ERROR:` line is interleaved with the source echo — it
   follows the `set` statement that provoked it and *precedes* that step's
   `run;` — so a renderer may not assume a step's source lines are contiguous.

Three things to carry into 2c and 3b. **`timeout` belongs at the call site, not
in an options bag** — upstream declares `wait` on the session state and never
passes it (finding 19), and the same omission here is a busy-wait that looks
correct and returns `200` every time. **A real 3a log is predicted to contain no
`source` lines** — a prediction, not a measurement: they appear here only because
this probe submitted inline `code[]`, and ADR-0014 chose upload plus `infile=`,
which finding 35 measured echoing nothing. 2c should confirm it the first time it
streams a real 3a submission. And
**a failing job's terminal state is `error` while its session stays `idle`**, so
only two of upstream's five terminal states have ever been observed — keep all
five anyway, because an unobserved extra member costs nothing and a missing one
is a loop that never exits.

The design those answers force is **ADR-0017**, written in this same pull
request: the loop is driven by the log's own long poll, `job.ts` stays neutral
about what its statements say so ADR-0014's mechanism remains 3a's, and the
stream is a self-driving pump behind ADR-0015's `AsyncIterable` rather than an
`async function*`. Read it before writing 2c — it also names the two upstream
recursions and the inverted `isDone` that the port must not carry forward.

**One thing 2c must fix in code before it can describe a job.**
`scripts/check-contracts.mjs` requires `via.from`, `via.relation` and `via.type`
to each be a string. A job's `cancel` and `delete` relations carry `type: null`,
and a *session's* omit the key altogether — `typeof undefined` fails the same
check — so either `type` becomes optional-or-absent-or-null on a `via` or none of
those endpoints can be declared. Found by sweeping for the superseded value
rather than by hitting it during 2c, which is the point of sweeping.

~~An undeclared endpoint the code calls is exactly what the checker's other
direction exists to catch.~~ **Wrong, corrected 2026-08-18 in 2c-ii.**
`scripts/check-contracts.mjs` never reads `src/compute/` and never looks at a
request: its three bidirectional pairs are contract↔dialect, contract↔fixtures,
and contract↔code only in the sense that `dialect:` must name a factory exported
under `src/dialects/`. A call the inventory does not describe passes the gate in
silence. Keeping the two in step is a person's job, done in the pull request that
adds the call — the same sentence was in ADR-0017 and is corrected there too.

**Narrowed 2026-08-17, while writing 2c-i: it is 2c-*ii* that must fix it, and
the fix is wider than the sentence above.** Seven endpoints — the whole
contexts → session → job → state → log chain, plus the session attach whose
composed URL the inventory had been missing since 2a-ii — were declarable without
touching the checker, because every one of their `via.type` values is a string
and `attach` has no `via` at all. The four
that cannot be declared are `cancel` and `delete` on each of a session and a job,
and none of them is called until 2c-ii writes `cancelJob`, so the relaxation ships
in the pull request that needs it rather than ahead of it. Note also that the
relaxation must accept **absent or null**, not just null: a session's `cancel`
omits `type` entirely, so a checker taught only about `null` would still reject
half of them.

**One design question 2c owns, deliberately left open by ADR-0017.** A pump that
polls whether or not anything is consuming `outputs` accumulates lines in memory,
so 2c must decide the buffer policy: whether there is a cap at all, what it is,
which end is dropped on overflow, and whether an overflow is reported to the
consumer. ADR-0017 records the consequence but takes no position on the remedy —
that decision belongs to the slice that writes the buffer.

**Settled 2026-08-17: cap it, drop the oldest, and count what was dropped.** The
cap is a named constant set high enough that no ordinary program reaches it, so
in normal use nothing is ever dropped and the policy is invisible. On overflow the
**oldest** lines go, because a runaway loop's last thousand lines are where its
failure is and its first thousand are its start-up; and the count of what was
dropped is **reported to the consumer** rather than silently absorbed, because a
log with a hole in it and no marker is a log that lies. This is 2c-ii's to build —
2c-i has no buffer in it.

Not settled, and listed in full at the end of the findings section: whether
`timeout` has a server maximum (60 was accepted but never elapsed, so a silent
clamp is indistinguishable from an honoured ceiling), whether a `WARNING:`
produces a `warning` line type or terminal state, and what `listing` and
`results` contain — the last of which is probably where 3c's ODS output lives.

**2c split in two, 2026-08-17, along the line the probe drew.** Everything the
findings settled about a *single request* is 2c-i; everything they settled about a
*loop* is 2c-ii. That puts job creation, job-state reading, the terminal set and
the stateless single-page log reader in the first, and the pump — the poll, the
drain, the `AsyncIterable`, the buffer, cancellation — in the second. The log
reader sits with the first rather than the second because `session.ts` established
that every function in these modules makes exactly one request and reports what
happened; a one-request function held back for the slice that loops over it would
be the first exception to that, and it would arrive with no test of its own.

☑ **2c-i punch list.** Complete 2026-08-17. Nothing here is user-visible, so there
is no hand-run procedure for this slice — the first thing a person can see is
2c-ii's stream.

- ☑ **Done 2026-08-17. `src/compute/job.ts` — create, state, terminal set, one log
  page.** Four exported calls, each one request, no retry, no timer, no composed
  URL: `createJob` follows a session's `execute`, `readJobState` reads the job's
  `state`, `readLogPage` reads from a cursor, and `followLogPage` follows a page's
  `next` exactly as sent. `TERMINAL_STATES` keeps all five of upstream's members
  and `isTerminal` reads the list **the right way round** — upstream's `isDone`
  tests `indexOf(state) === -1` and so answers `true` when the job is not done.
- ☑ **Done 2026-08-17. `readJobState` is unconditional, and that closes a door.**
  No `wait`, no `If-None-Match`, and therefore no `304` arm — `wait` is inert
  without a validator (finding 28), the job state's expiry has never been observed
  (finding 49), and ADR-0017 consults the state only after a poll came back fast
  and empty, which wants an immediate answer. With no `304` arm there is no place
  for upstream's `getState()` recursion to grow.
- ☑ **Done 2026-08-17. `timeout` is not optional on a log read.** It is always in
  the query, and a value that is not a positive integer is refused rather than
  sent, because a `timeout` computed to zero is the busy-wait wearing a disguise.
  The client timeout is `timeout + WAIT_MARGIN_SECONDS`, imported from
  `session.ts` rather than restated, so a client that aborts every poll a moment
  before it would have answered cannot happen by drift.
- ☑ **Done 2026-08-17. Blank log lines survive.** Six of finding 52's twenty-one
  lines are empty or whitespace, and `note` is a catch-all rather than a `NOTE:`
  prefix. The "drop empty values" reflex that `readLinks` and `readContext` both
  apply would delete the log's vertical spacing here, so the fixture test asserts
  the count and the blanks.
- ☑ **Done 2026-08-17. Seven endpoints declared in `contracts/viya4.yaml`** — the
  whole contexts → session → job → state → log chain, each naming the relation it
  is followed from, plus `compute_session_attach`, whose composed URL has been
  live since 2a-ii and was never in the inventory. That last one was found by the
  review pass below, and it is the failure this file is least able to catch on its
  own: nothing walks `src/` looking for requests, so an endpoint the code composes
  and the contract omits is invisible to the checker in the one direction that
  matters. Two fixtures alongside them, `compute-job-created.json` and
  `compute-job-log-page.json`, with the fixture README separating, item by item,
  what came off the wire from what was reconstructed.
- ☑ **Ratchet measured 2026-08-17, and deliberately not moved.** In
  `.c8rc.json`'s own order — lines, statements, functions, branches — the floor is
  **91 / 91 / 90 / 95** and the measurement was 91.68 lines, 91.68 statements,
  90.72 functions, 95.29 branches. Rounded down that is 91 / 91 / 90 / 95, which
  is exactly where the floor already sits, so `.c8rc.json` is unchanged: the rule
  is that a slice adding source raises the floor to `floor(measured)`, and here
  `floor(measured)` did not move. `job.ts` itself is 100 on all four; the
  `src/compute` directory is 99.83 lines and statements, 97.39 branches, 100
  functions, the shortfall being pre-existing lines in `client.ts`, `contexts.ts`
  and `problems.ts`. The drag is still `scripts/`, as it has been since 1b-i.

  Worth recording *how* it got there, because the first run failed the gate:
  branches came out at 94.82 against a floor of 95, with `job.ts` at 90.14 and
  **seven** uncovered lines. Six were real and now have tests: the `options?.
  signal` optional chain in each of `createJob`, `readJobState` and
  `followLogPage` (three, not four — `readLogPage` takes a required `options`, so
  there is no chain there to miss, and it got a signal test anyway); a body that
  is JSON `null`; a reply naming no media type; and an `id` or `state` that is
  present but empty. The **seventh** was an unreachable `parameters.length === 0`
  guard in a private helper only ever called with three parameters, and it was
  deleted rather than tested. A coverage failure that can only be fixed by
  writing a test for code that cannot run is the gate saying the code should not
  be there.
- ☑ **Done 2026-08-17. A failure path never quotes the body.** A log page is the
  one *response* in this project made entirely of the user's own program output,
  so `malformed` describes the response by status and media type and says what was
  wrong with it. `link-missing` takes its noun as an argument for the same class
  of reason: deriving it from the relation would be one `rel` away from telling
  someone their *session* has no log. The statements `createJob` sends travel the
  other way and are not the same problem — a `400` quoting them back is the user's
  own text returning to the user's own window, which is `problems.ts`'s stated
  reason for having no redaction pass. What would change that is a request body
  carrying something the user did not type, and nothing here sends one.
- ☑ **Done 2026-08-17. Adversarial review, and the one defect it found.**
  ~~No AI reviewer runs on this repository's pull requests, so~~ **the stated
  reason here was wrong, corrected 2026-08-18 in 2c-ii: Claude and Codex both
  review every pull request on this repository and have since 1a.** The subagent
  is not a substitute for them, it is a pass that happens *before* the pull
  request exists, and the case for it is cost rather than absence — a defect
  caught before the push costs one more local commit, while the same defect
  caught by a reviewer re-triggers both reviewers and all twelve required CI
  contexts. That is now the standing rule in `CLAUDE.md`. A subagent was pointed
  at the finished diff with instructions to find what would embarrass the author
  in public. It found a real bug and it was in the seam, not in the code: `LogPage`
  exposed only `lines`, so a caller advancing its cursor by `lines.length` would
  re-read a line after any dropped item, and on a page whose single item was
  dropped would not advance at all — a `start` the deployment answers instantly,
  which is a busy-wait reached through the parser rather than through a missing
  `timeout`. `LogPage.advance` now carries `items.length` and three tests hold the
  two numbers apart. Worth noting what made it findable: the bug was invisible in
  2c-i, which has no caller, and would have surfaced in 2c-ii as an intermittent
  duplicated line. Splitting a slice puts the seam under review before anything
  leans on it, which is an argument for splitting that was not in the original
  case for it. The rest of the review was paperwork drift, all of it fixed in the
  same change: `timeout=5` also elapsed, so ten is the *largest* verified ceiling
  and not the only one (corrected in finding 48 as well as in the code); a `404`
  on a job is read as `session-gone` on an ambiguity finding 53 names explicitly,
  which is now written down where the reading is made; `attachSession`'s composed
  URL was missing from `contracts/viya4.yaml` entirely, added here rather than
  explained away; the fixture README claimed no test asserted on a reconstructed
  part and then described one; and ADR-0017 still said the checker had to be
  relaxed before a job could be described, which 2c-i disproved by describing one.

☑ **2c-ii punch list.** Complete 2026-08-18. Like 2c-i, nothing here is
user-visible. The 2c-i entry
above predicted that "the first thing a person can see is 2c-ii's stream", and
that was optimistic: the pump has no command wired to it either. Nothing calls
`streamJobLog` outside its own tests until 3a builds a backend on it, and the
first thing a person can *see* is 3d-i's output channel. There is therefore no
hand-run procedure for this slice, and saying so is more useful than inventing
one that only proves a module imports.

- ☑ **Done 2026-08-18. `src/compute/logStream.ts` — the pump.** One exported
  function, `streamJobLog`, returning `{ events, done, cancel }`. `events` is an
  `AsyncIterable<LogEvent>` fed by a loop that is **already running**, not an
  `async function*` — ADR-0017 is explicit about why, and it is the one design
  point in this slice that cannot be recovered later by refactoring. A generator
  does not execute until something iterates it, so a caller that awaited `done`
  while ignoring `outputs` would deadlock against a job that finished on the
  server minutes earlier, and ADR-0015 requires the two halves of an
  `ExecutionHandle` to be independent. The pump starts on the call, buffers what
  the consumer has not taken yet, and settles `done` whether or not anyone ever
  iterates.
- ☑ **Done 2026-08-18. The loop is driven by the log's own long poll, and asks
  the state only when the timing says to.** `timeout=` really long-polls
  (finding 48), so the poll *is* the clock: a page that returned items advances
  `start` by `advance` and goes straight round again. An empty page is where the
  decision lives, and the two measurements that decide it are finding 48 — a
  live-but-silent job blocked the full window, 10.27 s for `timeout=10` — and
  finding 50, where a terminal job answered the same request in 0.26 s. An empty
  page that came back in under **half** the window is therefore evidence the job
  may have ended, and only then is the job state read. The heuristic decides
  *when to ask*, never what the answer is: the state resource is the sole
  authority on termination, and a fast empty page on a job that is merely idle
  costs one extra `GET` and nothing else.
- ☑ **Done 2026-08-18. `MAX_WINDOWS_WITHOUT_STATE_READ = 6`, because the timing
  evidence is one measurement on one deployment.** Finding 50 is a single
  observation. If some deployment lets an empty poll run its full window even
  on a terminal job, the heuristic above never fires and the stream never ends —
  a hang, which is the worst failure this module has available to it. So the
  state is read at least every six empty windows regardless of timing, which
  mirrors `MAX_WAIT_WINDOWS` in `session.ts` for the same reason it exists
  there. Under the observed behaviour this counter never reaches its limit; it
  is priced at one extra request per minute in the case where it does.
- ☑ **Done 2026-08-18. The drain reads once from the cursor, then follows
  `next` until the relation is absent.** Two mechanisms, deliberately, and each
  answers a different question. The re-read from the live cursor catches
  anything written between the last empty poll and the state read — a window
  that is small but not zero, and the log line it would drop is the last one,
  which is the one the user is looking at. Following `next` after that is the
  only correct way to reach the end: finding 51 saw a 21-line log at `limit=3`
  give a **full** final page with no `next` on it, so a drain that stopped on a
  short page would stop early on exactly the log that filled its last page. This
  is also what gives `followLogPage`, written in 2c-i with no caller, its
  production caller.
- ☑ **Done 2026-08-18. The buffer is capped on lines *and* characters, whichever
  is hit first, and the loss is reported twice.** A run that prints a hundred
  thousand short lines and a run that prints one enormous line are the same
  hazard to the extension host, and a single cap catches only one of them. The
  defaults are 100 000 lines and 16 000 000 characters. Characters are
  `String.length` — UTF-16 code units, not `Buffer.byteLength` — chosen so the
  module stays free of a Node global and remains loadable anywhere; the number is
  budgeted at roughly two bytes each and is a ceiling on memory, not an exact
  byte count. Oldest is dropped. The loss surfaces **in band**, as a
  `{ kind: "dropped", lines, characters }` marker sitting at the hole so a reader
  can see *where* output went missing, coalesced so that repeated overflows leave
  one growing marker rather than a run of them; and **again** as a total on the
  settled outcome, so a caller that only awaits `done` still learns the log is
  incomplete. Settled with Sean 2026-08-17: either report alone leaves one of the
  two callers blind.

  The coalescing happens on the way **out**, which is not how this item first
  described it. A marker already at the head is shifted off with everything else
  and its tally carried into the marker written afterwards; there is no
  "head is already a marker, so merge into it" branch, and there cannot usefully
  be one, because shifting a marker changes neither bound and the trim loop
  therefore keeps going until the head is a line or the queue is empty. The
  branch existed until the adversarial review below asked which input reached it.
- ☑ **Done 2026-08-18. Cancellation aborts first and sends second, with no
  signal on the second.** `cancel()` aborts the pump's controller so `done`
  settles promptly for the person who pressed the button, then sends the `PUT` —
  and it sends it carrying **no signal at all**, because passing the controller
  just aborted would abort the very request meant to stop the job. There is no
  replacement controller either: nothing in the module has a reason to abort the
  request that stops a job, so a "fresh signal" would be a parameter with no
  caller. The cost of getting this wrong is not the 900-second reaper of finding
  18, which measures an *inactivity* timeout and does not run while a job is
  executing: the program would run to completion unattended, and only then would
  the idle clock start. Cancelling a stream whose job is already over sends
  nothing and succeeds: ADR-0015 requires it, and a `PUT` at a job whose session
  the reaper has taken is a `404`, which would surface as a reported failure for
  pressing Cancel on a finished run. "Already over" begins at the terminal state
  rather than at the settling of `done` — see the review item below. Concurrent
  calls share one in-flight promise rather than sending twice.
- ☑ **Done 2026-08-18. Cancellation is a success value, not a problem.**
  `cancelled` is a `BackendProblem` and deliberately not a `ComputeProblem`, so
  this layer has no vocabulary for it as a failure and reports `outcome:
  "cancelled"` on a successful result instead. 3a translates that into ADR-0015's
  `cancelled` failure, which is the layer that knows the user asked for it. The
  dropped-line total is carried on the cancelled outcome too — cancelling does
  not make the missing output less missing.
- ☑ **Done 2026-08-18. `cancelJob` in `src/compute/job.ts`, and the `delete`
  relation left undeclared.** One more one-request call in the shape the module
  established: follow the `cancel` link with its query string intact, send no
  `If-Match`, read nothing back. Whether a long-running Python step actually
  stops promptly is **unmeasured** and is written down as unmeasured in both the
  code and the contract; what is claimed is that the request was accepted. There
  is no `deleteJob` and there is not going to be one by accident: reading a `404`
  from a job resource as `session-gone` (finding 53) is only sound while nothing
  in this extension can have deleted the job, so the absence is load-bearing and
  says so beside the function.
- ☑ **Done 2026-08-18. `scripts/check-contracts.mjs` accepts a `via.type` that
  is a media type *or* `null`, and still requires the key.** A session's `cancel`
  and `delete` omit `type` on the wire; a job's carry it as `null` (findings 21
  and 46). Both mean "this relation involves no representation", and the checker
  previously refused to let either be written down. The key must still be
  *present*, because a forgotten media type and a genuinely absent one are
  otherwise the same absence, and the first is a bug. Three endpoints follow:
  `session_cancel`, `session_delete` and `job_cancel`. That is the fix the 2c
  section above predicted, arriving in the slice it predicted. The same three
  endpoints needed the same treatment for `accept`, which the review below found.
- ☑ **Done 2026-08-18. The false claim about the checker, swept from both places
  it reached.** ADR-0017 and this file both said that an endpoint the code calls
  and the contract omits "is what the checker's other direction exists to catch".
  It is not. `scripts/check-contracts.mjs` checks contract↔dialect,
  contract↔fixtures, and contract↔code only in the narrow sense that `dialect:`
  must name a factory exported under `src/dialects/` — **nothing in it reads
  `src/compute/` or looks at a request at all**. Both copies are struck through
  and corrected rather than edited away, because the sentence was load-bearing:
  it is why `compute_session_attach` sat undeclared from 2a-ii to 2c-i. Keeping
  the inventory in step with the calls is a person's job, done in the pull
  request that adds the call.
- ☑ **Done 2026-08-18. Adversarial review, and the nine changes it produced.**
  The standing rule from 2c-i, applied to the finished diff: a subagent was
  pointed at it with instructions to find what would embarrass the author in
  public. Twelve findings, each verified by hand before anything moved — the
  2c-i entry above records that four of six were wrong on inspection last time,
  so verification is the load-bearing half of the exercise. All twelve stood.
  Three of them are the corrections written into the items above; the rest are
  here.

  **`MAX_DRAIN_PAGES = 10 000`, for the same reason
  `MAX_WINDOWS_WITHOUT_STATE_READ` exists.** The drain's only exit was the
  deployment ceasing to send a `next` relation, which is finding 51: one
  observation, of one 21-line log, on one deployment. A `next` pointing at
  itself, or kept alive by a rewriting proxy, is an unbounded request storm
  behind a `done` that never settles — precisely the failure the counter thirty
  lines above exists to make impossible in the *other* loop. Leaving one loop
  bounded and its neighbour unbounded was holding the same evidence to two
  standards. Ten thousand pages is two million lines at the default page size,
  twenty times what the buffer will hold, and reaching it is reported as
  `response-malformed` rather than passed off as a finished log: a drain that
  stopped early and said nothing is the hole-with-no-marker this module refuses
  to produce anywhere else. Three weaker options were rejected on the way — a
  bound derived from the buffer cap (dishonest, since the drain keeps the
  *later* lines), a cycle detector alone (blind to an advancing but endless
  chain), and silent truncation (a lie by the module's own standard).

  **`accept: text/plain` on three endpoints was fabricated.** `session_cancel`,
  `session_delete` and `job_cancel` are a `PUT` and two verbs whose links carry
  no `responseType`, and `acceptFor` in `src/compute/client.ts` falls back to
  `type` **only on a `GET`** — so all three requests go out with no `Accept`
  header at all. Three headers in the file that calls itself "the record of what
  we depend on" that no request has ever sent. `accept` is now media-type-or-null
  on exactly the two-part shape `via.type` uses — the key is still required,
  because a forgotten value and an absent one are otherwise the same absence —
  and all three say `null`.

  **A cancel arriving during the drain used to send a `PUT`.** `settled` is set
  in `pump().finally()`, so it covers only the interval after the promise
  resolves, and the drain sits between the terminal state and that. Cancelling
  there sent a pointless `PUT` — a `404` against a reaped session, which
  `cancelJob` reads as `session-gone` and would report as a failure of the one
  operation ADR-0015 requires to succeed — *and* abandoned the tail of a log
  that was already complete on the server, with nothing to count and so no
  marker to leave. A separate `finished` flag, set the moment the state comes
  back terminal, is what `cancel()` reads. The outcome stays `terminal`: the run
  really did finish.

  **`done` could reject, and ADR-0015 lets a caller ignore it.** `pump` has no
  `try`, so a caller-supplied `now` that throws — or a client that rejects
  instead of returning a failure — becomes an unhandled rejection, which under
  Node's default policy takes the extension host down for a mistake the user did
  not make. A `void done.catch(() => undefined)` attaches a handler to a second
  reference, leaving `done` itself rejecting for whoever does await it.

  The rest were prose, all of it in this file, in `CHANGELOG.md` or in the
  module's own doc-comments, and all of it fixed in the same change: the "fresh
  signal" that no code created, finding 18 cited three times for a timeout it
  does not measure, 0.26 s of a 10 s window called five per cent when it is
  under three, "the state is read at least this often" said of a counter that
  only ever spans *empty* windows, and "one extra state request" for what is one
  per empty window and therefore a sustained doubling on a deployment where
  every empty poll returns fast.
- ☑ **Ratchet raised, 2026-08-18.** `logStream.ts` imports no `vscode`, so it
  landed in the coverage denominator with no `.c8rc.json` exclude and the
  aggregate moved. Measured over 853 passing tests, after the two review
  responses below: **92.25 statements, 95.31 branches, 91.41 functions, 92.25
  lines**, so the floors go to **92 / 95 / 91 /
  92** — statements and lines up one, functions up one, branches unchanged
  because 95.31 still rounds down to the 95 already in place. The rule is
  unchanged: a slice adding source raises each floor to `floor(measured)`, and
  the floor is never lowered to accommodate a slice.

  The module itself scores 100 % of statements, functions and lines with 97.93 %
  of branches, the two uncovered branches (lines 697 and 736) being the
  `if (… === undefined) break;` guards after a `queue.shift()` that a
  `while (this.queue.length > 0)` has already proved non-empty — unreachable by
  construction, and kept because `shift()` types as `T | undefined`. That is
  why the aggregate moved *up* rather than being dragged down by a thousand new
  lines: a fully covered module raises the total, which is the shape the ratchet
  is meant to reward.
- ☑ **Codex's one blocking finding, answered 2026-08-18 — and it was wrong on the
  claim that made it blocking.** The reading: `cancel()` sends the stop request
  with no signal, so a `PUT` the deployment never answers hangs the `cancel()`
  promise forever, and because concurrent callers share one memoised promise none
  of them can recover. Checked against `client.ts` rather than argued: `send`
  composes `AbortSignal.timeout(timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS)`
  into **every** request and combines it with the caller's signal with
  `AbortSignal.any` rather than choosing between them, and `cancelJob` sets no
  `timeoutMs`, so the request fails at thirty seconds as `compute-unreachable` and
  `cancel()` settles with that failure. Unsignalled is not unbounded.

  Adding a controller as asked would have been a real defect rather than a
  no-op: the only thing a signal on *that* request buys is the ability to abandon
  it, and the one request this module must not abandon is the one that stops the
  job.

  What the finding did establish is that the comment invited the reading — two
  readers reached it independently, since the adversarial subagent asked the same
  question earlier. So the comment now says where the bound comes from, and a
  test — *"settles when the deployment never answers the cancel"* — scripts the
  cancel request failing as `compute-unreachable` and asserts that `cancel()`
  resolves with that failure while `done` still ends `cancelled`. A reviewer's
  question that the code cannot answer by itself is worth a test even when the
  answer is "already correct".
- ☑ **The Claude reviewer's nit, taken rather than argued, 2026-08-18.** `done`
  is guarded against a caller-defect rejection with `void done.catch(…)` on a
  second reference; the memoised `cancelling` promise had no equivalent, so a
  caller that fires `cancel()` without awaiting it — the plausible shape at a
  tear-down call site — would turn a rejecting `ComputeClient.send` into an
  unhandled rejection. `send` is contracted never to reject, but it is an
  **injected interface**, so the contract holds only for the implementations this
  repository ships and a test double is the likeliest thing to break it. One line,
  same pattern, and `cancelling` still rejects for whoever awaits it.

  No test, deliberately, and for the same reason `done`'s guard has none: the
  assertion would be the *absence* of a process-level `unhandledRejection`, which
  needs a listener installed around the suite and reports in whichever test
  happens to run next when it misfires. An instrument whose false positive lands
  on an unrelated test is worse than the defect it watches for.


---

## Probe findings

## 2026-08-14 — The Compute service (Viya 4)

The wire shapes slice 2a is written against. Findings 13 to 17 were re-run
read-only while writing `src/compute/`, and every payload below is copied from
that run with the context ids replaced; findings 18 to 20 come from the session
probe earlier the same day and are marked where a detail was not re-captured.

Two deployment-level observations, neither of which needed a finding of its own.
**TLS verified** — every request in this section ran without `curl -k`, against
the deployment's own certificate. And a **CSRF token is issued but not required**:
responses carry `x-csrf-header: X-CSRF-Token` and `x-csrf-token: …`, and no
request here sent one back. Bearer callers are exempt, which is what lets the
client stay stateless.

### Finding 13 — Hrefs are root-relative, already carry `/compute`, and repeat in `uri`

Every link in every representation observed:

```json
{
  "method": "POST",
  "rel": "createSession",
  "href": "/compute/contexts/CONTEXT-ID/sessions",
  "uri": "/compute/contexts/CONTEXT-ID/sessions",
  "type": "application/vnd.sas.compute.session.request",
  "responseType": "application/vnd.sas.compute.session"
}
```

No absolute URL appeared anywhere, and `href` and `uri` were identical in every
link seen. The service prefix is **already in the href**, which is the fact
behind upstream's `link.href.replace("/compute", "")`: upstream stores a base
that ends in `/compute`, so it has to cut the prefix back off every href it
follows. Storing the deployment root and concatenating deletes the cause instead
of patching the effect.

**Consequence.** `resolveHref` joins the normalised endpoint to the href by
concatenation and refuses anything that is not root-relative — a protocol-relative
`//host/…` would send the bearer token to a host the deployment named.

### Finding 14 — `links[].type` omits the `+json` suffix, and is absent rather than `null`

The media type in a link is the **essence without the structured suffix**:
`application/vnd.sas.compute.session.request`, where the header the service
accepts is `application/vnd.sas.compute.session.request+json`. Sending the link's
value verbatim as `Content-Type` is a 415.

A link that has no media type **omits the key**. Across all 13 contexts and every
link on each, the key sets were exactly three:

```text
href+method+rel+uri                            (delete)
href+method+rel+type+uri                       (self, alternate)
href+method+rel+responseType+type+uri          (createSession)
```

**Correction to an earlier reading.** An earlier note recorded `type` as
arriving "as a string, `null`, or absent on the same logical link". That was a
`jq` artifact: projecting `{rel, type}` prints `"type": null` for a key that is
not there. Re-checked with `has("type")`, **no explicitly-null `type` was
observed on this deployment**. `readLinks` still accepts `null` — JSON permits
it, the cost is one union member, and a media type of `null` and one that is
absent mean the same thing to us — but it is defensive breadth, not an
observation.

### Finding 15 — One filtered call resolves a context, and the escape for an apostrophe is doubling it

`GET /compute/contexts?filter=eq(name,'SAS Job Execution compute context')`
returns the summary item **already carrying a fully-formed `createSession`
link** (finding 13's payload is that link). Upstream follows this with
`GET /compute/contexts/{id}` before creating a session; that second call is
unnecessary.

The filter is a query parameter, so the whole expression is percent-encoded on
the way out. The service echoes it back in its `self` link, encoded its own way:

```json
"href": "/compute/contexts?start=0&limit=10&filter=eq%28name%2C%27SAS+Job+Execution+compute+context%27%29"
```

Three spellings of a name containing an apostrophe were tried, since upstream
interpolates the name into the filter with no escaping at all:

| Filter | Result |
|---|---|
| `eq(name,'O''Brien')` | **`200`**, `count: 0` — a well-formed query for a context that does not exist |
| `eq(name,'O\'Brien')` | `400`, `errorCode` 1104, *"The filter … is not valid."* |
| `eq(name,'O'Brien')` | `400`, `errorCode` 1104, same message |

**Consequence.** Doubling the quote is the escape. A backslash is not, and the
unescaped form is a `400` — so a context whose name contains an apostrophe breaks
upstream's query outright. `src/compute/contexts.ts` doubles it before encoding,
and there is a test that says so.

### Finding 16 — `count` is `null` exactly when the collection is truncated

The deployment has 13 compute contexts. Varying only `limit`:

| Request | `count` | `items` | `next` link |
|---|---|---|---|
| `?limit=2` | `null` | 2 | present |
| `?limit=12` | `null` | 12 | present |
| `?limit=13` | `13` | 13 | absent |
| `?limit=14` | `13` | 13 | absent |
| `?start=10&limit=10` | `null` | 3 | absent (`collection`, `first`, `prev`, `self`) |

So `count` is a real number **only when the page already holds everything**, and
`null` in every case where a pager would actually need it — including the last
page of a traversal, which has no `next` and still reports `null`. A filtered
collection that fits on one page does report a count (`count: 1` for the query in
finding 15).

**Consequence.** Page on the presence of the `next` link and treat `items` as
authoritative. Nothing may branch on `count`: read as a number it is `0`, and
"there are no compute contexts" is the one answer that is never true.

### Finding 17 — The error envelope is `application/vnd.sas.error+json`

A malformed filter, verbatim but for the correlator:

```json
{
  "message": "Bad Request",
  "errorCode": 1104,
  "httpStatusCode": 400,
  "version": 2,
  "details": [
    "The filter 'eq(name,'O'Brien')' is not valid.",
    "path: /compute/contexts",
    "correlator: 00000000-0000-4000-8000-000000000000"
  ]
}
```

Sent as `content-type: application/vnd.sas.error+json;charset=utf-8;version=2` —
note the **`version` parameter on the media type**, which any content-type
comparison has to tolerate.

`details` mixes one human sentence with two machine entries under `path:` and
`correlator:` prefixes. The correlator is what SAS support asks for. The `path:`
entry is our own request reflected back, and `readViyaError` drops it rather than
quoting it.

### Finding 18 — A session is created with `201` + `Location` + `ETag`, and dies after 900 idle seconds

From the session probe. `POST` to a context's `createSession` link answered
**`201`** with a `Location` header — root-relative, like every other href — and an
`ETag`. The session arrives in state `pending`, carrying the links everything
else navigates by, and `attributes.sessionInactiveTimeout` is **`900`**.

`DELETE` on the session's `delete` link answered **`204`, with no `If-Match`
sent**. Upstream attaches that header unconditionally; it is not required, and an
ETag we are not sure of turns a working teardown into a `412` that leaves a SAS
process running until the fifteen minutes elapse.

Fifteen idle minutes is short enough that session death is **routine rather than
exceptional** — it is what happens over lunch, and 2a-ii treats it as a
recoverable event rather than an error.

### Finding 19 — The session state resource is a real server-side long poll

`GET …/state?wait=5` with a matching `If-None-Match` held the connection and
answered **`304` after exactly five seconds**. The wait is honoured server-side.

Upstream declares this option and never passes it, polling the *log* endpoint
instead — which conflates "has it finished" with "is there more log", and is why
`ComputeJob.getState()` recurses under its author's own comment *"This is bad. We
need to cache the last state value."*

**Consequence.** One round trip per window, no `setTimeout`, and the poll takes
an abort signal so 2a-ii has somewhere to attach a `CancellationToken`.

### Finding 20 — The log is a paged collection of typed lines

The job log is not a blob. It is a collection whose items carry a line's text and
its **type**, which is what makes it possible to tell a `NOTE:` from an `ERROR:`
without parsing prefixes out of a string. Finding 16's paging rule applies to it
like any other collection.

*Superseded in detail by findings 47–52 (2c-pre), which enumerate the item's
three fields, the four `type` values, and the paging and long-poll behaviour.
The sentence above is right but stops well short of what a client needs — in
particular `note` turns out to be a catch-all, so "tell a `NOTE:` from an
`ERROR:`" is true of `error` and misleading about `note`.*

### Finding 21 — The session representation carries 22 links, and they are the whole API

Probed 2026-08-14 while writing `src/compute/session.ts`, which needed to know
whether a session is navigated by link relation or by composed path. One throwaway
session was created in the SAS Studio compute context, dumped, and deleted in the
same call. The scrubbed payload is
`test/fixtures/viya4/compute-session-created.json`.

`POST` returned `201` with
`content-type: application/vnd.sas.compute.session+json; charset=utf-8; version=2`
— note the **spaces after the semicolons**, where the error type in finding 17 has
none, so a comparison that is not parameter-tolerant fails on one or the other —
plus a root-relative `Location` and an `etag` — written `"<etag-1>"` here and
below, where both occurrences stood for the same ten-character opaque validator
the server returned for that one throwaway session.

Top-level keys: `applicationName`, `attributes`, `creationTimeStamp`,
`description`, `environment`, `id`, `links`, `name`, `owner`, `serverId`,
`serviceAPIVersion`, `sessionConditionCode`, `state`, `stateElapsedTime`,
`version`. `attributes` is `{homeDirectory, sessionInactiveTimeout: 900}`. The id
is a UUID with a `-ses0000` suffix. `applicationName` is **the OAuth client id**
and `owner` is the user's email address — both scrubbed in the fixture.

The 22 relations, which is the entire session API and the reason nothing below
2a-i needs a URL builder:

| rel | method | href tail | type |
|---|---|---|---|
| `self` / `alternate` | GET | `` | `…compute.session` / `.summary` |
| `state` | GET | `/state` | `text/plain` |
| `cancel` | PUT | `/state?value=canceled` | *(no `type` key)* |
| `delete` | DELETE | `` | *(no `type` key)* |
| `execute` | POST | `/jobs` | `…job.request` → `…job` |
| `jobs`, `log`, `listing`, `results`, `variables`, `engines`, `formats`, `informats`, `librefs` (`/data`), `files` (`/filerefs`) | GET | various | `…collection`, plus an `itemType` key |
| `assign` | POST | `/filerefs` | `…fileref.request` → `…fileref` |
| `getFiles` | GET | `/files` | `…file.properties` |
| `getOption` / `updateOption` | GET / PUT | `/options/{optionName}` | `text/plain` |
| `logAsText` / `listingAsText` | GET | `/log`, `/listing` | `text/plain` |

Three consequences beyond "the links are there".

**`cancel` is a link, and it already carries its query.** Upstream builds this
call by hand — `setState(ComputeState.Canceled)` with an `If-Match`, retrying on
`412` by recursing into itself without a bound. The deployment hands us
`PUT …/state?value=canceled` ready to follow. It is also the one observed href
with a query string, which is why appending `?wait=N` to a *different* href has to
test for one rather than assume none.

**`getOption`'s href is an un-expanded URI template**: `/options/{optionName}`,
braces and all. It is the first href seen that cannot be followed verbatim, so
ADR-0010's "follow what the service sends" needs the qualifier that a templated
href is expanded first — and the brace-free ones are still never rewritten.

**Collection links carry an `itemType` key** that `readLinks` ignores. Harmless,
recorded so the next person does not think the fixture is truncated.

The state resource answered `200`, `content-type: text/plain;charset=UTF-8`, body
`pending` — **7 bytes, no trailing newline** — and `etag: "<etag-1>"`, byte for
byte the ETag the create call returned. So the session ETag and the state
validator are the same value at creation, which is what makes finding 19's
`If-None-Match` poll work from a freshly created session. `DELETE` on the `delete`
link answered `204` with no `If-Match`, confirming finding 18 a second time.

### Open questions this probe did *not* settle

- **What a reaped session answers.** Finding 18 gives the timeout but the probe
  did not wait one out, so whether a dead session replies `404`, `401`, or
  answers normally having lost its state is unobserved. 2a-ii treats all three
  alike for that reason.
- ~~**Whether `type` is ever explicitly `null`** on a representation other than a
  context.~~ **Answered by finding 21 for sessions and by finding 46 for jobs,
  and the two do not agree.** A session's `cancel` and `delete` links **omit the
  key**, exactly as context links do; a *job's* `cancel` and `delete` links set
  it to **`null` explicitly**. Both forms mean "no representation involved", and
  a client must treat absent and null alike — a contract that types the media
  type as a required string is rejected by a real Viya response.
- ~~**Whether `count` behaves the same way on the session and log collections.**~~
  **Answered for the log by finding 47:** it is a live running total that moved
  10 → 11 → 12 across three polls of a running job, and it was never `null`.
  Session collections remain unvaried. The rule "trust `next`, not `count`" is
  written to be safe either way and stays — on a running job `count` is stale the
  moment it is read, which is a second reason not to lean on it.
- **Viya 3.5.** Still unreachable, so none of the above is confirmed there. The
  link-driven navigation is what makes that survivable: a 3.5 deployment that
  spells an href differently is followed, not fought.

## 2026-08-14 — Filter literals, in answer to a review question (Viya 4)

Review of the 2a-i pull request asked whether the apostrophe is really the *only*
character `quoteFilterValue` has to escape, since a filter value also travels
through the `(` `)` `,` that give `eq(name,…)` its structure. Finding 15 had only
ever tried the apostrophe, so the question was fair and the answer was assumed.
It is now measured. Read-only `GET /compute/contexts` throughout, TLS verified.

### Finding 22 — Inside a quoted literal, the apostrophe is the only special character

Every value below sits inside `eq(name,'…')` and is percent-encoded on the way
out by `curl --data-urlencode`, exactly as `contextsLink` encodes it:

| Value inside the quotes | Result |
|---|---|
| `zzz-no-such-context` (control) | `200`, 0 items |
| `zzz)no-such` | `200`, 0 items |
| `zzz(no-such` | `200`, 0 items |
| `zzz,no-such` | `200`, 0 items |
| `zzz"no-such` | `200`, 0 items |
| `zzz no-such` | `200`, 0 items |
| `zzz\no-such` | `200`, 0 items |
| `a),b(` | `200`, 0 items |
| `zzz'no-such` (bare apostrophe) | **`400`**, `errorCode` 1104 |

A `200` on its own is weak evidence: a parser that mis-read the literal and
matched nothing looks identical to one that read it correctly and matched
nothing. So each punctuation literal was also composed with a term that *does*
match, in both orders, so that a parser which ended the literal early or split on
the comma could not still return the right answer:

| Filter | Result |
|---|---|
| `eq(name,'SAS Studio compute context')` | `200`, **1 item**, that name |
| `or(eq(name,'a),b('),eq(name,'SAS Studio compute context'))` | `200`, **1 item**, that name |
| `or(eq(name,'x,y'),eq(name,'SAS Studio compute context'))` | `200`, **1 item**, that name |
| `or(eq(name,'x''y'),eq(name,'SAS Studio compute context'))` | `200`, **1 item**, that name |
| `or(eq(name,'SAS Studio compute context'),eq(name,'a),b('))` | `200`, **1 item**, that name |
| `contains(name,'o), (c')` | `200`, 0 items |
| `contains(name,'Studio')` | `200`, **1 item** |

The structural characters are therefore consumed as ordinary text once the
literal is open, and the closing apostrophe is what ends it — which is why a bare
apostrophe is the one failure in the table. One further check, so that "doubling
works" is not confused with "`''` is ignored":
`eq(name,'SAS Studio'' compute context')` returns `200` with **0 items**. A
doubled apostrophe decodes to exactly one character, and one that the real name
does not contain.

**Consequence.** `quoteFilterValue` escaping only `'` is correct rather than
merely untested, and it is now recorded as measured. Note what this finding does
**not** license: the value must still be percent-encoded afterwards, because `&`
and `#` end a query parameter in the URL long before the filter parser sees them.
The two escapes are separate, they compose in one order only, and finding 15
already fixes that order.

## 2026-08-14 — Session lifecycle, before wiring the reconnect path (Viya 4)

Slice 2a-ii has to decide where a session id is persisted, and that decision
turns entirely on what a *stale* id costs: whether a dead session can be told
from a live one, whether an abandoned session can be found again without one, and
whether anything about a session is worth keeping across a window reload. None of
that is observable from a `GET`, so this is the first **mutating** probe in this
file. Three throwaway sessions were created in the SAS Studio compute context,
each named `python-on-viya/probe`, each deleted in the same shell call under a
`trap`, and the deletes were confirmed `204`. TLS verification was disabled for
the probe only.

Values below are scrubbed: the deployment's identity ids are email addresses, so
one is written `user@example.com`, and the OAuth client id is written
`<oauth-client-id>`.

### Finding 23 — A session settles to `idle`, not to `running`

`POST` to the context's `createSession` link answered **`201` in 6.4 s** in state
`pending`, and reached its settled state at roughly **7 s**. That settled state is
**`idle`**. A session is `running` only while a job is executing in it (finding
27), so "the session came up" and "the session is busy" are different words, and
the plausible guess — wait for `running` — would wait forever.

This is the finding `src/compute/session.ts` was written blind against, and it
survives it. `waitWhilePending` names only `PENDING_STATE` and waits for that to
*end*, handing the caller whatever came next rather than testing for a state name
we had never seen. The comment in that module — *"A list of state names we have
never seen would look like knowledge"* — is now the reason the code is right
instead of the reason it is cautious. **Do not** add `idle` as an awaited value;
add it, if anywhere, as a documented observation.

### Finding 24 — `name` and `description` are accepted at create, and `name` is filterable

The session request body took `name` and `description`, and both came back on the
created resource. The response also carried an `applicationName`, which this probe
did not send: it is the **OAuth client id of the token**, not anything the caller
chose. Filtering the collection then behaved:

| Filter over `/compute/sessions` | Result |
|---|---|
| `eq(name,'python-on-viya/probe')` | matched, count 1, our id |
| `eq(name,'python-on-viya/no')` | `200`, 0 items |
| `contains(name,'python-on-viya')` | matched, our id |
| `and(eq(name,…),eq(state,'running'))` | `200`, 0 items (the session was `idle`) |

Per finding 22's standard, each positive row was checked against a session known
to exist, not merely for a `200`. Summary items in that collection carry
`["id","links","name","owner","version"]` — no `state`, so the state a filter can
match on is not a field the summary hands back.

**Consequence.** A session this extension created is *self-identifying* on the
server. That is what makes reclaim-by-listing possible at all, and it costs one
string at create time.

### Finding 25 — `owner` is the identity `id`, and here that id is an email address

The created session's `owner` compared **equal** to the `id` from
`GET /identities/users/@currentUser`, and
`and(eq(owner,'user@example.com'),eq(applicationName,'<oauth-client-id>'))`
returned exactly our session. So the reclaim filter needs no extra lookup beyond
the identity call slice 1c already makes, and it can be narrowed to sessions this
extension started rather than every session the user owns — including the ones
SAS Studio left behind.

Two cautions, both load-bearing:

**The listing is not caller-scoped.** `GET /compute/sessions` under this token
returned other people's sessions. The token is an administrator's, so this may be
a privilege artefact rather than the general case, but the client must not treat
the collection as "mine" — the `owner` term is doing real work, not decoration.

**The `id` is personal data on this deployment.** It is an email address. That
contradicts the framing of finding 8, corrected there. It also means a session
`name` built from the identity id would publish a user's email into a
server-side resource that other callers can list — so the marker in `name` must
be a constant, and the *user* narrowing must come from `owner`, which the server
already knows and did not learn from us.

### Finding 26 — Session names are not unique, and nothing pretends otherwise

Creating a second session with the identical `name` returned **`200`** with a
distinct id, and `eq(name,…)` then matched **2**. There is no uniqueness
constraint and no conflict status to catch.

**Consequence.** Reclaim-by-listing must be written for *n* matches, not one: a
crashed window, a second window, and a reload all leave candidates behind. Taking
"the first item" would be a coin flip between a live session someone is using and
an abandoned one. Whatever 2a-ii does here has to be a stated rule.

### Finding 27 — The session state moves while a job runs, and lags the job at the end

Sampled through an 8-second `PROC PYTHON` step:

| t | session state | job state |
|---|---|---|
| +1 s | `running` | `running` |
| +4 s | `running` | `running` |
| +8 s | `running` | `running` |
| +12 s | `running` | **`completed`** |
| +15 s | `idle` | `completed` |

The job reached `completed` while the session was still `running`, and the
session returned to `idle` a few seconds later. Submitting the job answered
**`201`** with the job in state `pending`, carrying link relations
`self, state, cancel, delete, log, logAsText, listing, listingAsText, results, up`.
The log came back as 23 typed lines (`normal`, `note`, `source`), with the
`print` output present as `normal` lines separate from the `source` echo — finding
20, re-confirmed on a Python step.

**Consequence.** Completion is a property of the **job**, and the run path must
poll the job's state resource. Watching the session for `idle` would report a run
finished two to three seconds late and would be actively wrong the moment a
second job is submitted. The session state is still the right signal for a
different question — *is this session alive and free* — which is exactly the
question reconnect asks.

### Finding 28 — The long poll needs `If-None-Match`; `wait` alone does nothing

Finding 19 measured the session state holding for `wait=5` and answering `304`.
Two extensions, both measured on a job that slept 12 seconds:

| Request | Result |
|---|---|
| job state, plain `GET` | `200` in 0.3 s, `running` |
| job state, `?wait=6`, **no** `If-None-Match` | `200` in **0.3 s**, `running` |
| job state, `?wait=20` **with** `If-None-Match` | `200` in **12.96 s**, `completed` |
| session state, `?wait=8` with `If-None-Match`, session idle | `304` after 8.3 s |

So `wait` is not a sleep. Without a validator the server has nothing to compare
against and answers immediately; with one it holds until the value changes and
**releases at the moment of change**, not at the end of the window — 12.96 s for
a 12-second step. The `wait` is a ceiling, and a `304` on expiry is the signal to
poll again with the same ETag.

**Consequence.** A run costs about one request per `wait` window plus one at
completion, and the completion latency is a network round trip rather than a
polling interval. Sending `wait` without `If-None-Match` would silently degrade
into a hot spin — the request looks correct and returns `200` every time — so the
two belong together in one call site, not as independent options a caller can
mix. The session-state variant answers `304` where the job-state variant answered
`200` with a changed body, so both arms have to be handled.

### Finding 29 — A dead session answers `404` to everything, and a stale id cannot be diagnosed

After `DELETE` returned `204`, three requests against the same session:

| Request | Result |
|---|---|
| `GET` the session's `self` href | **`404`**, `errorCode` **5837** |
| `GET` its `state` | **`404`**, `errorCode` **5837** |
| `POST` a job to its `jobs` href | **`404`**, `errorCode` **5837** |

The body is the standard error envelope, with `details[]` naming the session id
and the path. A well-formed but **invented** session id — never created, never
deleted — returns the same `404` and the same `5837`.

**Consequence, and it is the one 2a-ii turns on.** *Gone* is a single, uniform,
cheap answer on every verb, so a stale id costs exactly one failed round trip and
needs no probing before use: attempt, catch the `404`, create a new session. That
is the whole recovery path. But the server cannot tell us *why* it is gone —
expired at 900 s, deleted by an administrator, lost with the compute node, or
never ours to begin with are one status code. So no message we write may claim a
reason, and the code must key on the **status**, not on `errorCode` 5837, which is
an undocumented internal number that costs nothing to stop matching on now and
would cost a debugging session to discover had changed.

### What this probe did not settle

- **A reaped session.** Every `404` here followed an explicit `DELETE`. A session
  that died on its own at 900 idle seconds is *assumed* to answer identically and
  was not waited out. The assumption is cheap to hold — the recovery path is the
  same either way — but it is an assumption.
- **Whether the non-caller-scoped listing survives a non-admin token.** See
  finding 25. This is the one result most likely to be a privilege artefact, and
  a reclaim feature that only works for administrators would be worse than none.
- **Whether `attributes.sessionInactiveTimeout` can be *set* at create.** The
  request accepted an `attributes` object; nothing was put in it. Finding 18 read
  the 900 back, it did not write it.
- **Concurrency.** Two jobs submitted to one session at once were not tried, so
  what the session state reports mid-overlap, and whether the second queues or
  fails, is unknown. 2a-ii should serialise per session regardless.
- **Viya 3.5**, as everywhere else in this file.

## 2026-08-16 — Cross-check after the 2a-iii manual run (Viya 4)

Every finding above was produced by a probe talking to the server directly. This
one is different in kind: it looks at what the **shipped extension** left on the
server after a human ran the 2a-iii procedure in `RUNBOOK.md` through step 9, and
it is here because the compute session id is deliberately never logged, so from
inside the editor there is no way to see whether a `DELETE` landed. Read-only
throughout — one collection `GET`, one session `GET`, one state `GET`. TLS
verification was disabled for the probe only. The endpoint is scrubbed as
elsewhere.

### Finding 30 — Sessions are cleaned up, and `applicationName` cannot tell our client from SAS's

Step 9 alone creates and destroys a session five or six times: disconnect,
connect, disconnect, connect-and-cancel, connect-and-cancel-at-the-picker,
connect properly. Immediately afterwards, `GET /compute/sessions?limit=50`
returned `count: 1` and one item:

| Field (from the single-resource `GET`) | Value |
| --- | --- |
| `name` | `python-on-viya` |
| `state` | `idle` |
| `creationTimeStamp` | the last connect, to the second |
| `applicationName` | `vscode` |
| `attributes.sessionInactiveTimeout` | `900` |
| `attributes.homeDirectory` | `…/compsrv/default/<session-id>` |

**What that says about our code, which is the point.** Six creates, one survivor:
every `DELETE` the session manager issued reached the server and took its session
down. Had `disconnect` merely dropped our local reference — the failure mode step
9's *`Reconnected` must not appear here* check exists to catch — this listing
would show the pile.

**What it says about the API, and it is a correction of emphasis.** Finding 24
established that `applicationName` is the OAuth client id of the *token*, not
anything the caller sends. This is the first sighting of that field for the client
the extension actually uses, and the value is `vscode` — the built-in client id
(see the OAuth findings above). That id is not ours. SAS's own VS Code extension
authenticates with the same built-in client, as would any other tool that reused
it, so **`applicationName` cannot narrow a listing to sessions this extension
started**. Finding 25 offered `and(eq(owner,…),eq(applicationName,…))` as the
reclaim filter; that pairing is right about `owner` and wrong to lean on
`applicationName`, which here would sweep in every session the SAS extension left
behind for the same user. The only marker that is ours is the constant in `name`,
which is exactly why finding 25 insisted the name be a constant. This does not
revive reclaim-by-listing — ADR-0012 rejected it on the strength of finding 26,
that names are not unique — but if it is ever reconsidered, the filter in finding
25 must not be copied as written.

**Corroborations, offered as corroborations rather than news.** The 900-second
timeout read back again (finding 18). A settled session was `idle`, not `running`
(finding 23). The collection item carried exactly `id`, `links`, `name`, `owner`,
`version` — no `state`, no timestamps — so a list still cannot tell a live session
from a dead one without a `GET` per item (finding 24). And `count` was populated
on a collection that was not truncated (finding 16), which is the other half of
that finding stated positively for the first time.

**One reading to avoid.** A single item is *not* evidence that the listing has
become caller-scoped. Finding 25 saw this same token return other people's
sessions; the honest reading of `count: 1` is that at that moment the deployment
held one compute session in total, which is what a quiet personal test system
looks like at half past nine at night. `homeDirectory` is likewise not new
information — it is the session id under a fixed prefix — and nothing should be
built on its shape.

### What this cross-check did not settle

- **Whether a reaped session disappears from the listing or lingers as a `404`
  href.** The session was still inside its 900 seconds when it was read, and the
  reaper was not waited out. Finding 29's gap, unchanged.
- **The second deployment.** Only the working profile's endpoint was queried, so
  nothing here says what the cancelled step-6 sign-in left behind on the other
  one. It should be nothing — the connect never reached a session — but that is
  reasoning, not an observation.
- **Viya 3.5**, as everywhere else in this file.


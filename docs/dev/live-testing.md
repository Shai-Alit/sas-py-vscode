# The live test tier in anger

`npm run test:live` is the only tier that talks to a real SAS Viya deployment.
It is opt-in, gated three separate ways, and never runs in default CI. This page
is for a maintainer who has a deployment and credentials in front of them and
wants to run it. The shape of the tier and why it is gated the way it is are in
[Testing](testing.md#tier-three-live); this page is the operational detail.

## What you need

A Viya deployment you are allowed to talk to, and a bearer token for it. How you
get the token is out of scope here — an OAuth flow against the deployment's
`SASLogon`, a service account, whatever your site uses — but it must be a real
token for a real user, because the suites read `/identities/users/@currentUser`
and expect an id back.

## The three gates

### 1. The script

Only `npm run test:live` points Mocha at `test/live/`, via `.mocharc.live.json`.
`npm run verify` and `npm run test:unit` cannot reach a real server no matter
what is in your environment — the spec globs do not overlap. (The live config is
a separate file rather than a `--spec` flag because `--spec` *merges* with the
`spec` in `.mocharc.json`, so a live run would quietly execute the unit suite
too.)

### 2. Per-generation environment variables

| Generation | URL | Token |
|---|---|---|
| Viya 4 | `PYTHON_ON_VIYA_TEST_VIYA4_URL` | `PYTHON_ON_VIYA_TEST_VIYA4_TOKEN` |
| Viya 3.5 | `PYTHON_ON_VIYA_TEST_VIYA35_URL` | `PYTHON_ON_VIYA_TEST_VIYA35_TOKEN` |

```bash
PYTHON_ON_VIYA_TEST_VIYA4_URL=https://viya.example.com \
PYTHON_ON_VIYA_TEST_VIYA4_TOKEN=<bearer token> \
npm run test:live
```

The names are prefixed on purpose: they live in a developer's shell, not in a
config file scoped to this repository, and a bare `ALLOW_MUTATION` exported for
some other project would silently open this one's write gate.

Rules the gate enforces (`test/helpers/live-gate.ts`, unit-tested including every
refusal path):

- **A generation with neither variable set skips.** A tier that fails when it is
  not configured gets disabled, and a disabled tier never runs anywhere.
- **A half-configured pair throws.** URL set and token unset (or the reverse) is
  a misconfiguration that cannot otherwise be told apart from an untouched
  machine — found the hard way on 2026-08-19.
- **The URL must be `https://`.** The gate refuses to send a bearer token over
  plaintext, rather than skip.

### 3. `PYTHON_ON_VIYA_ALLOW_MUTATION=1`

Checked separately, by `requireMutation`, at the point of the first write in
every mutating suite. Read access and write access are different decisions:
pointing the suite at a shared deployment to read from it should not also grant
permission to create sessions and filerefs there.

```bash
PYTHON_ON_VIYA_TEST_VIYA4_URL=https://viya.example.com \
PYTHON_ON_VIYA_TEST_VIYA4_TOKEN=<bearer token> \
PYTHON_ON_VIYA_ALLOW_MUTATION=1 \
npm run test:live
```

Without it, the read-only suites run and the mutating ones skip.

## When it fails on the certificate rather than the request

A deployment behind an internal certificate authority fails like this:

```
TypeError: fetch failed
Caused by: Error: unable to verify the first certificate
```

That is TLS, not authentication, and it is expected. This tier runs under bare
`node`, which trusts its own bundled CA list and nothing else; the extension
never meets the problem because VS Code loads the OS certificate store into the
extension host. Point Node at the chain for the run:

```bash
NODE_EXTRA_CA_CERTS=/path/to/viya-ca.pem npm run test:live
```

The file must contain the **issuing** authority, not only the server's own leaf.
`NODE_OPTIONS=--use-system-ca` is the alternative where the root is already in
the OS store — and on a SAS-issued machine pointed at an internal `verde`-style
deployment it is the one that works: `NODE_EXTRA_CA_CERTS` with the local
`cacert.pem` bundle was **not** sufficient for Node there (2026-09-03), even
though `curl --cacert` against the same bundle succeeded. Neither belongs in the
test code — a live tier that disables verification to go green is worse than one
that skips.

If every case fails with `compute-unreachable`, look locally first: that is what
a TLS or proxy problem on *your* machine looks like from here. The connectivity
suite fails the same way (as `fetch failed` rather than `compute-unreachable`),
which is why it is worth running on its own first.

## The suites, and what each costs the deployment

Read-only (gates 1 and 2):

| Suite | What it does | Deployment cost |
|---|---|---|
| `viya4-connectivity.test.ts` | `GET /identities/users/@currentUser`, asserts an id comes back | one request |
| `viya35-connectivity.test.ts` | the same, gated on `liveTarget("viya35")` — see [below](#the-viya-35-scaffold) | one request |

Mutating (all three gates):

| Suite | What it does | Deployment cost |
|---|---|---|
| `viya4-job.test.ts` | resolve a context, start a session, `%put` a per-run marker, read the log to the end, delete the session | one session (deleted), one job (taken by the session teardown) |
| `submission-corpus.test.ts` | upload five curated corpus files through a fileref and read each back byte for byte | one session (deleted), five filerefs |
| `proc-python-rich-output.test.ts` | run a real matplotlib figure through `ProcPythonBackend`, assert the `image/png` and that the captured file is deleted after (ADR-0019) | one session (deleted), one job, one PNG written then deleted |
| `viya4-job-cancel.test.ts` | submit a 30-second `data _null_` sleep (prefixed with a `%put` of a per-run random marker), cancel it once it is running, assert `cancelJob`'s `If-Match` round trip is accepted (Findings 75/76) | one session (deleted after the cancelled step runs out its natural duration — see below), one job |

### The cleanup contract for mutating tests

Every mutating suite owes the deployment two things (`CONTRIBUTING.md`):

1. **A per-run unique value**, so one run's objects are never confused with
   another's. It does *not* have to be the object's name: `viya4-job.test.ts`
   creates a session named `SESSION_NAME`, a constant inside the module under
   test, because a test that passed a name of its own would no longer be
   exercising what the extension does — the uniqueness lives in the log marker
   it writes and reads back. Where a name is shared like that, the suite's own
   doc comment says how a run's objects are told apart.
2. **Cleanup in a Mocha `after` hook** — the one place a failure partway through
   the test cannot skip. The hook clears its handle *before* the delete request,
   so a second failure does not spin, and reports a failed cleanup with
   `console.warn` rather than failing the run: a cleanup failure must not turn a
   passing run red, but it may have left a SAS process on someone's real
   deployment, and the person who ran the suite is the only one positioned to go
   and look. The warning names the session so they can.

`viya4-job-cancel.test.ts` is the sharp case: Finding 76 measured that a
cancelled step runs its full natural duration before SAS tears it down, so the
`after` hook's `deleteSession` blocks for whatever of the 30-second sleep was
left. That is why the suite's timeout is 120 s for what looks like a quick test.

### Failure messages name the endpoint and the status code, nothing else

`live-gate.ts` sets this rule for the whole tier. A live run's output goes into
terminals, screenshots and bug reports; a real session id, an internal hostname,
or a user's identity does not belong in any of them. In practice:

- Report a `ComputeProblem` by its `code` and, where there is one, the HTTP
  status — never by the `reason` string beside it, which on the rejected path
  carries the deployment's own sentence (measured saying
  `A session with the ID "…" could not be found.`).
- Never log a token. Not in an assertion message, not in a failure dump, not in
  a fixture.

The helper each suite uses for this is called `describeFailure`; copy it when
adding a suite rather than interpolating `problem.reason`, which at the call site
looks like the more helpful choice.

## The Viya 3.5 scaffold

`viya35-connectivity.test.ts` exists so `liveTarget("viya35")` is reachable from
a real suite and the clean-skip path is exercised. **This project has never
talked to a live Viya 3.5 deployment.** Per `docs/README.md`'s standing rule, no
test presents 3.5 as *supported* while that is true, so the suite asserts only
the narrowest honest thing: the gate resolves, a token reaches the identities
service, an id comes back. It does not touch compute, jobs, or `PROC PYTHON` — a
suite written from documentation for those would look identical to one proven
against a deployment and be worth far less.

If you have a 3.5 deployment: set the `..._VIYA35_...` pair and run it. **That
first run is the verification.** `viya4-connectivity.test.ts`'s own first run on
2026-08-19 failed — on the identity media type [finding
6](../phases/phase-1.md) records — and 3.5's behaviour on that same endpoint is
exactly what is still unknown (`src/auth/identity.ts`'s summary-then-full
fallback is built for it). Record what you see as a numbered finding in the
current phase file, and take the scaffold from a connectivity smoke to real
coverage from there.

## What the live tier covers, and what it does not (5b audit, 2026-09-03)

The tier proves that the wire shapes the unit fixtures recorded are still the
shapes a live deployment sends, for:

- authentication and identity (`viya4-connectivity`);
- context resolution, session lifecycle, job submission and log streaming —
  slice 2c (`viya4-job`);
- fileref upload fidelity — slices 2b/3a (`submission-corpus`);
- rich-output capture end to end — slice 3c-i / ADR-0019
  (`proc-python-rich-output`);
- the job-cancel `If-Match` round trip — slices 4b/4c, Findings 75/76
  (`viya4-job-cancel`, added in 5b to close the gap the audit found).

Deliberately **not** covered by a live test:

- **Traceback structuring** (`parseTraceback`, slice 3c-ii) and the
  **traceback-to-diagnostics offset mapping** (`tracebackDiagnostics.ts`, slice
  4c). Both are pure text transforms over the log lines the streaming suites
  already prove arrive intact; they are exhaustively unit-tested against
  recorded fixtures and carry no additional wire risk. `proc-python-rich-output`
  does run a real failing-adjacent path (it asserts `succeeded`), but no suite
  asserts on the structured `application/vnd.python.traceback` output shape
  against a live run.
- **The diagnostics surface** (Problems panel, click-to-jump — slice 4d). This
  is VS Code integration with no new Viya calls; the integration tier and the
  [manual test pass](manual-test-pass.md) cover it.
- **`probeRuntime()` / environment info** (slice 3e). The full wire sequence was
  probed by hand (phase-3 Finding 71) but there is no live *test*; whether a
  deployment has a Python interpreter is a property of the deployment, and a
  test that failed without one would be reporting site configuration as a
  defect.
- **Anything Viya 3.5.** See above.

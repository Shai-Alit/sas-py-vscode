# Phase 3 — Run Python (the vertical slice)

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 3 — Run Python (the vertical slice)

This is the phase that makes the extension real.

**3a — `PROC PYTHON` backend.** Submission per the 2-pre findings, with **escaping
as a named deliverable** and regression tests for the injection cases. The
**submission fidelity corpus** (§4) ships in this slice, in both its unit and live
forms, and the slice is not done until every case in it round-trips byte for byte
— the quoting failures in §1.5 are silent, so the corpus is the only thing
standing between a user and a program that runs and means something else. The
**offset map** from submitted-block lines to editor lines, session options
(`PAGESIZE=MAX` to suppress page-break headers), `freshNamespace` handling, the
busy/serial contract, and success/failure detection. *Medium.*

> **Amended 2026-08-16 by the 2-pre findings.** Submission is upload plus
> `proc python infile=<fileref>;`, so **escaping is not the deliverable — upload
> fidelity is**. The corpus still ships in this slice and still has to round-trip
> byte for byte; what it exercises is the upload/`If-Match`/`infile=` path, not a
> quoting function, because nothing tokenises the file's contents. The offset map
> gets simpler too: with no source echo and no wrapper block, the file's line
> numbers are the editor's. Success/failure detection reads `SYSCC` from
> `GET /compute/sessions/{id}/variables/SYSCC` — but read it per job rather than
> assuming the observed per-job reset to `0` is contractual.

**3b — Log filter.** SAS log → clean Python stdout: strip page-break headers,
`>>>` markers, and procedure NOTEs. Pure-function, heavily
unit-tested against recorded log fixtures — including the awkward real-world cases
where a page break splits the stdout region mid-stream, and where stdout volume is
large enough to paginate.  *Medium.*

> **Amended 2026-08-17 by 2c-pre**, findings 47 and 52. Two changes. First,
> **stripping the numbered source echo is no longer expected to be needed**:
> 3a submits via `infile=`, which echoes no source (finding 35), so a 3a log
> should carry no `source` lines at all — a prediction 2c confirms the first
> time it streams a real submission, not a measurement. Second, **the filter
> switches on the line's `type`, not on its prefix**: every line arrives as
> `{line, type, version}` and the four observed values are `source`, `note`,
> `normal`, `error`. `normal` is the user's own output — that alone is most of
> the filter. Beware `note`: it is a catch-all that also covers continuation
> lines, whitespace-only lines and blank ones, so "hide notes" would delete the
> log's vertical spacing. The vocabulary is open, so an unrecognised `type` is
> passed through rather than dropped.

**3c — Rich output probe, then implementation.** **Probe first, per the standard
workflow.** Determine how matplotlib figures and DataFrame HTML can be returned —
candidates are writing to the session filesystem and fetching via the Compute
files API, or base64 through the log. Only after the probe settles the mechanism
do we implement `RichOutput` capture. *Unsized until the probe lands — this is the
one slice whose scope is genuinely unknown.*

**3d-i — Commands and text output.** `Run file`, `Run selection`, `Cancel`,
`Reset Python state`; output channel for streamed stdout and the raw log; progress
and status bar integration; the user-facing error surface (when to use a
notification vs the output channel vs Problems). Text-only, and **already
shippable**. *Medium.*

This slice also answers *how the user chooses Viya over the local interpreter*,
which is the question a first-time user asks before any of the above matters. The
answer is [ADR-0011](../adr/0011-choosing-where-python-runs.md): each workspace
has a **run target** — a profile, or Local — set from the status bar, published
as the `pythonOnViya.runTarget` context key, and used to decide whether this
extension puts a run affordance in the editor at all. It lives in
`workspaceState`, so two *different* workspaces are independent while two windows
on the same folder share one target — the same qualifier ADR-0007 states for the
active profile. When the target is Local we contribute
nothing and Microsoft's run button is the whole story; we never launch a local
interpreter, so the "no local Python" constraint stays literally true. Commands
mean what their titles say from anywhere, so the target governs *placement* and
never routing. Upstream's answer does not transfer: the SAS extension claims a
Python file only when `resourceScheme` says it was opened from Viya, which is
precisely not the file this extension exists to run. No keybinding ships in this
slice — every plausible default collides with something — so the beta gets to say
which one people reach for.

**3d-ii — Result panel webview.** The repo's first webview: build config, CSP,
host↔webview messaging, and renderers for the `RichOutput` union. Accessibility is
in scope, not deferred. *Medium.*

> **Open item, found during 3b's review (2026-08-25):** nothing in the
> `ExecutionBackend` seam is localised today — `backend.ts`'s own doc comment
> on `RichOutput` names the extension-authored English strings that exist so
> far (three when this item was written; 3c-i's `richOutput.ts` added a
> fourth, `skippedCaptureOutput`, so the count is not this item's own point —
> the seam having no localisation boundary at all is). Neither `procPython.ts`
> nor `logFilter.ts` may import `vscode`
> (ADR-0009), so `l10n.t()` has nowhere to live upstream of here, and ADR-0015
> never assigned this seam a localisation boundary. 3d-i's output channel and
> this slice's webview are the first layers in the chain that already have to
> import `vscode`, so whichever of the two renders `outputs`/`diagnostics`
> first is where that boundary gets decided — not by threading `vscode` down
> into the backend to solve one string at a time.

**3e — Runtime capability probe, and telling the user what they can import.**
Stage-2 capabilities (§2.3): interpreter version and path, installed package set,
confirmation that `PROC PYTHON` works. Needs 3a and 3b, which is why it lives here
and not in 2b. Surfaces in the status bar.

The **installed package set is a user-facing deliverable of this slice, not just a
capability record.** A developer writing Python in this extension is writing
against an interpreter they cannot see, on a machine they cannot log into, whose
package set was chosen by someone else and can change under them without notice.
Left invisible, every unavailable import is discovered as a traceback at run time
— and worse, the local environment lies convincingly, because Pylance is happily
resolving `import polars` against the packages on the *laptop*. The minimum this
slice ships is a **`Python on Viya: Show environment` command** that lists the
interpreter version, path, and installed distributions with their versions,
sourced from `importlib.metadata` rather than by shelling out to `pip`; a status
bar affordance that opens it; and a per-profile cache with an explicit refresh,
because it is a slow answer that changes rarely. Phase 10 goes further and feeds
that package set back to Pylance so completions match the remote environment;
Phase 4's traceback work should special-case `ModuleNotFoundError` and point at
this list. *Small/medium — the listing itself is small; deciding how to present a
list that can run to hundreds of entries is most of it.*

*Exit:* select Python in an editor, run it on Viya, see stdout streamed live and
rich output rendered. **This is the first genuinely useful build.**


---

## Runbook

```bash
# 3a — PROC PYTHON backend
git checkout -b phase-3a-proc-python-backend
git commit -m "feat(python): add PROC PYTHON execution backend"
# the real commit dropped "with offset mapping" — see the "Landed" note below

# ⛔ BARRIER
# 3b — log filter
git checkout -b phase-3b-log-filter
git commit -m "feat(python): add SAS log to Python stdout filter"
```

> **Landed 2026-08-21, merged as PR #50.** `src/backend/procPython.ts` and
> `src/compute/variables.ts`, three rounds of review (an adversarial subagent
> pass, then Claude and Codex on the open PR — full detail, including the two
> real Codex findings and the reverted coverage regression, is in
> `docs/phases/phase-2b.md`'s 3a punch list rather than repeated here, since
> that punch list is where this slice's obligations were tracked). Final
> state at merge: 970 tests passing, coverage
> 92.99/95.1/92.43/92.99 against the 92/95/91/92 floor, ratchet raised to
> 92/95/92/92 — later raised again to 93/95/92/93 when 3b landed, above.

> **Landed 2026-08-24 as `src/backend/logFilter.ts`.** Extracted from
> `procPython.ts`'s own shortcut — that module could not produce any output at
> all without deciding *something* about which log lines were noise, and did
> so inline in 3a. This slice gives the decision (`isNoiseLine`,
> `logLineOutput`, `droppedLinesOutput`) its dedicated, pure, fixture-tested
> home, switching on a line's `type` rather than scanning its text.
> `procPython.ts` now calls into it instead of carrying its own copy. Covered
> by `test/unit/backend-log-filter.test.ts`, including finding 52's 21-line
> recorded log verbatim. Full detail in `CHANGELOG.md`'s entry rather than
> repeated here.
>
> **Also settled here:** this item's own plan text, above, still describes the
> pre-2c-pre shape of the problem — "strip page-break headers, `>>>` markers" —
> which does not survive that probe's findings: the log arrives as typed lines
> rather than text to scan, so neither concern applies to what this filter
> actually does. Separately, `PAGESIZE=MAX` (named under 3a's own plan text) is
> still not sent at session creation — a real gap, recorded in the CHANGELOG
> entry rather than fixed here, since it does not change this filter's design
> either way.

> **⚠ 3c is a probe slice, not an implementation slice.** Do not let it start as
> "implement rich output." Run the probe, write up what the mechanism actually is,
> *then* size the implementation. This is the one slice in the plan whose scope is
> genuinely unknown, and pretending otherwise is how it swallows the phase.

☑ **3c step 1 — probe.** Using the `viya-api-probe` skill and `creds.json`,
determine how a matplotlib figure and a DataFrame HTML repr can be retrieved.
Candidates: write to the session filesystem and fetch via the Compute files API,
or base64 through the log. Done 2026-08-25 against `verde` (Viya 4) — findings
61–66 below. **The file-write-plus-Compute-files-API mechanism won outright**:
byte-perfect for both a PNG and an HTML table, with the server reporting the
correct MIME type unprompted. Base64-through-the-log is not viable as a naive
channel — finding 62 measured a hard character-count wrap with no boundary
marker, which corrupts anything long enough to wrap unless the emitting code
adopts its own chunking-and-reassembly protocol, which the file mechanism makes
unnecessary. A second pass (findings 65–66) closed the two gaps the first
pass left open: `deleteFile` needs `If-Match` with an ETag obtainable from a
properties `GET` alone, no content fetch required, and the mechanism holds at
a realistic image size (262,591 bytes, not just 23,206).

☑ **3c step 2 — size and split.** Turn the findings into one or more sized slices.
**Confirmed 2026-08-25: 3c-i** — matplotlib/pandas rich-output capture
via write-to-session-filesystem + Compute-files-API fetch, decoded into the
existing `RichOutput` union (`image/png`, `text/html`); *Medium*. Traceback
structuring (`application/vnd.python.traceback`) does not depend on anything
this probe found — finding 39 already established tracebacks arrive as ordinary
log lines — so it stays a separate item, **3c-ii**, rather than being sized
against this probe's findings.

```bash
# 3c-i — matplotlib/pandas rich-output capture (findings 61-66)
git checkout -b phase-3c-i-rich-output-capture
git commit -m "feat(python): capture matplotlib/pandas rich output via the session filesystem"

# ⛔ BARRIER
# 3c-ii — traceback structuring
git checkout -b phase-3c-ii-traceback-structuring
git commit -m "feat(python): structure Python tracebacks for the result panel"

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

# ⛔ BARRIER
# 3f — manual test pass regressions (pre-Phase-4 hardening)
git checkout -b phase-3f-manual-test-regressions
git commit -m "fix(run): close manual-test-pass regressions (connect-state, silent failures, page-break banner)"
```

☑ **3c-i — matplotlib/pandas rich-output capture.** Scoped 2026-08-25, design
confirmed the same day: **[ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)**
settles the mechanism (a passive before/after directory diff, not an explicit
helper library the user's script would have to import) and every wire-level
detail (the size cap, the closed `.png`/`.html` whitelist, ordering,
cleanup, cancellation). This is the punch list for executing it — read the
ADR first; it is not repeated here.

> **Landed 2026-08-25, merged as PR #59.** `src/python/richOutput.ts` and
> `src/compute/files.ts`, capturing matplotlib/pandas output via the
> before/after working-directory diff ADR-0019 settles. Findings 67–70 in the
> Probe findings section below record what the implementation turned up.

- **`src/compute/files.ts` (new).** Owns the Compute service's files API:
  listing a session's working directory (`getFiles` → `getDirectoryMembers`,
  ADR-0010 link-following, never a composed path), reading one file's
  content, and deleting one file with `If-Match` off a `getFileProperties`
  `GET`'s `ETag` (finding 65, relation name confirmed by finding 68 — not
  `self`/`delete`, both plausible guesses finding 68 ruled out). Mirrors
  `variables.ts`/`fileref.ts`'s shape — one small area of the Compute API,
  own module, never imports `vscode`.
- **The transport layer needed a prerequisite it did not have** (finding 69):
  `auth/transport.ts`/`src/compute/client.ts` could not carry a binary
  response body byte-for-byte or above a 1 MiB cap before this slice. Fixed as
  part of it — `TransportResponse.bytes()`, `ComputeResponse.rawBody`,
  `maxBodyBytes` — see finding 69 and the short amendment on ADR-0019 itself.
  Not a change to ADR-0019's own decision, but load-bearing for
  `readFileContent` to be correct at all.
- **`src/backend/richOutput.ts` (new).** The pure decision logic ADR-0019
  describes: diff two directory listings by name+size, filter to the
  `.png`/`.html` whitelist, sort by filename, and map a fetched file's bytes
  plus extension to a `RichOutput` (base64 for `image/png`, UTF-8 decode for
  `text/html`). No I/O, no `vscode` — same discipline as `logFilter.ts`, and
  the same reason: this is exactly the kind of decision that wants
  fixture-tested coverage independent of a real Compute client.
- **`src/backend/procPython.ts`'s `runProgram` wired to call both**, in the
  order ADR-0019 gives: snapshot before `createJob`, snapshot after the job
  settles (skipped entirely if the outcome is `cancelled`), diff, fetch and
  push each candidate's `RichOutput` to the relay, delete what was
  successfully captured. A candidate that fails to fetch or exceeds the
  10 MiB cap pushes a `text/plain` note naming it instead of failing the run
  — same "best-effort, report honestly" shape `readSyscc` already uses for
  `SYSERRORTEXT`.
- **Known, accepted l10n gap, same as `logFilter.ts`'s and this documented
  elsewhere:** the new "could not retrieve rich output file …" note is
  another extension-authored English string this seam cannot run through
  `l10n.t()` (`procPython.ts` still may not import `vscode`). Add it to
  `backend.ts`'s existing list in the `RichOutput` doc comment rather than
  treating it as a new, separate gap.
- **Test plan**, matching the existing shape for a new Compute module plus a
  new pure `backend/` module:
  - `test/unit/compute-files.test.ts` — the new module against a recorded
    transport, the same pattern `compute-variables.test.ts` already uses.
  - `test/unit/backend-rich-output.test.ts` — the pure diff/filter/sort/decode
    logic against plain fixtures, including a before/after listing pair
    shaped like what finding 61's probe actually observed, and a real tiny
    PNG byte fixture for the decode path (not a recording — a real, minimal
    PNG belongs in `test/fixtures/`, same as the submission corpus's own
    fixtures are real files, not descriptions of files).
  - `test/unit/proc-python-backend.test.ts` extended: a recorded run whose
    "after" listing carries a new `.png` and a new `.html` produces both
    `RichOutput`s, in filename order, after the run's text output; a run
    whose candidate exceeds the size cap produces the skip note instead; a
    cancelled run captures nothing at all.
  - A live test against `verde`, gated the same way `viya4-job.test.ts`
    already is, actually running `fig.savefig(...)` through a real session
    and asserting the `RichOutput` that comes back — the unit tier proves
    this backend calls the right things in the right order, not that a real
    deployment answers the way the recording assumes.
- **Coverage-scope check** (`scripts/check-coverage-scope.mjs`) — nothing to
  declare by hand: the check derives the exclude list from the AST itself, and
  ran clean against both new files unmodified (neither imports `vscode` nor is
  types-only), same as `logFilter.ts`/`variables.ts`/`fileref.ts` today.
- **Adversarial subagent review before this is proposed** — this slice adds
  source and a new documented invariant (ADR-0019 itself), squarely the case
  this repo's standing policy requires it for.

☑ **3c-ii — traceback structuring: drop the harness's wrapper frames.** Scoped
and landed 2026-08-25/26. Unlike 3c-i, this did not need a probe (finding 39
already has the wire shape) or an ADR (a narrow correction, not a competing
design) — it needed a scope decision, since three docs disagreed about who
owns what.

**What this slice found, before writing any code:** `parseTraceback` and the
`application/vnd.python.traceback` `RichOutput` already shipped in **3a**
(PR #50) — a Python exception already arrived as a structured `Traceback`,
unfiltered. What was genuinely still open was the harness's own two `<stdin>`
wrapper frames (finding 39), which neither 3a nor 3b dropped — `logFilter.ts`'s
doc explicitly left "turning that traceback into a structured `Traceback`" to
3c, and `backend.ts`'s `TracebackFrame.file` doc and `procPython.ts`'s own
module doc disagreed about whether dropping the wrapper frames traveled
together with mapping a frame to a `ProgramOrigin` (an editor position) or
was separable from it.

**Settled: the two are separable, and only the wrapper-frame drop is this
slice's job.** `logFilter.ts`'s own doc and this phase file's own 3e/Phase 4
text already pointed at **Phase 4** owning the editor-position mapping (its
`ModuleNotFoundError` special-casing only makes sense once a frame maps to a
line in the user's file); `backend.ts`'s `TracebackFrame.file` comment was the
one place still asserting 3c owned both, and was stale relative to the other
two. Corrected in the same change rather than left disagreeing.

- **`src/backend/procPython.ts`'s `parseTraceback`** drops the harness's
  `<stdin>` frames — **only the leading contiguous run of them**, immediately
  after the header, stopping at the first frame that is not one. A header
  found with only that leading run and no real frame at all (the harness
  itself failing) returns a `Traceback` with an empty `frames` array,
  distinct from "no frame lines at all," which still falls back to a plain
  `SYSERRORTEXT` message as before.
- **`src/backend/backend.ts`'s `TracebackFrame.file` doc corrected** to say
  wrapper frames are already dropped by 3c-ii and that mapping to a
  `ProgramOrigin` is Phase 4's job, not 3c's — matching `logFilter.ts` and
  this file's own Phase 4 text instead of contradicting them.
- **A real, blocking defect in the first version of this fix, caught by
  automated PR review (Codex), not by the adversarial subagent pass below:**
  the first `parseTraceback` change dropped *every* frame labelled `<stdin>`,
  anywhere in the stack, reasoning (wrongly, as stated in a now-corrected
  doc comment) that only the harness could ever produce that label. It can't
  be true in general: user code that itself calls
  `compile(src, "<stdin>", "exec")` (or `eval`/`exec` against a code object
  built that way) can raise from a frame the runtime also labels `<stdin>`,
  and a by-name filter would silently erase that real user frame. Such a
  frame can only ever appear *below* at least one non-harness frame, though,
  never at the very top — so the fix restricts the drop to the leading run
  only, verified by hand-tracing the fix against the exact scenario the
  review named. The adversarial subagent pass that ran before the PR was
  opened checked the filter against finding 39's own recursion case and the
  empty-frames edge case, and did **not** catch this — both passes' findings
  are recorded here rather than only the one that turned out right, per this
  project's own reviewer-calibration practice.
- **Test plan:** `test/unit/proc-python-backend.test.ts`'s existing
  "structured traceback" case asserts the leading `<stdin>` frames are gone;
  one case confirms recursion-produced `<string>` frames all survive; one
  confirms the harness-only-failure shape returns an empty `frames` array
  rather than falling back to a plain message; a fourth, added for the review
  finding above, confirms a user-generated `<stdin>` frame appearing *below*
  a real frame survives untouched. No new Compute module, no new probe, no
  live test — this changes pure decision logic already inside
  `parseTraceback`'s existing unit coverage.
- **Adversarial subagent review before this is proposed** — it changes a
  documented invariant (`TracebackFrame.file`'s own contract), the same bar
  3c-i's ADR-0019 change was held to, even though this slice carries no ADR of
  its own. Re-run after the review-finding fix above, over the corrected diff.

☑ **3d-i — contribute the run target, and let it decide whether we appear.**
[ADR-0011](../adr/0011-choosing-where-python-runs.md) settles the mechanism; this
is the punch list for executing it.

> **Scope note, settled before any code was written.** This phase file's own
> plan text (above) describes 3d-i broadly — "Commands and text output: `Run
> file`, `Run selection`, `Cancel`, `Reset Python state`; output channel…" —
> but the Runbook punch list below, as it stood going into this slice, detailed
> only ADR-0011's run-target mechanism (the picker, the context key, the
> `workspaceState` store) and never said how the run/cancel/reset commands
> themselves would be built, even though the punch list's own bullets already
> assumed `editor/title/run`/`editor/context` entries existed to gate. Asked
> directly rather than guessed at: the full plan-section scope is what this
> slice covers, not the narrower Runbook-only reading. Recorded here because
> the two documents disagreed and a future reader should not have to
> reconstruct which one won.

> **Landed 2026-08-26, merged as PR #63.** `src/run/target.ts` (pure — `RunTargetKind`,
> `resolveRunTargetKind`, `runReadiness`, `runTargetPickEntries`),
> `src/run/render.ts` (pure — `RichOutput` to display-line shape),
> `src/run/targetStore.ts` (the `workspaceState` shell), `src/run/statusBar.ts`
> (supersedes `src/profile/statusBar.ts`, removed in this slice — same item id,
> new job, per ADR-0011), `src/run/outputChannel.ts` (the program-transcript
> channel, separate from the extension's own log channel) and
> `src/run/commands.ts` (`selectRunTarget`, `runFile`, `runSelection`,
> `cancelRun`, `resetPythonState` — the first module to ever construct a
> `ProcPythonBackend` from a live `ComputeConnection`). `src/backend/messages.ts`
> is new alongside it — `localiseBackendProblem`, the `compute/messages.ts`-style
> split `BackendProblem` was always missing, deferred here from 3a per that
> module's own doc comment. `backend.ts`'s `RichOutput` doc is corrected to say
> what this slice actually decided about the seam's localisation boundary
> (3d-i's own strings are localised; the four `RichOutput`/`PythonDiagnostic`
> payload strings named there are not, and stay a known gap).
>
> **Design decisions made while executing the punch list, not separately
> planned:**
> - The stored target is only ever `"local"` or `"viya"` — never a profile name
>   of its own. Choosing a Viya profile in the picker writes both the target
>   *and* `ProfileStore`'s active-profile pointer in one gesture, but the two
>   remain two stores; `"viya"` with no active profile (`runReadiness`'s
>   `"no-profile"` reason) is reached by switching the target to Viya before
>   picking a profile, not folded into `"local"`. **No longer the
>   fresh-install shape** — see [ADR-0020](../adr/0020-run-target-defaults-to-local.md)
>   below; the fresh-install default is `"local"` now.
> - `Run File` passes `freshNamespace: true`; `Run Selection` passes `false`,
>   so repeatedly running a selection builds on state the way a notebook cell
>   would — `backend.ts`'s own doc names Run File and a notebook cell as the
>   two examples and leaves a selection unassigned; this slice assigns it to
>   the notebook-cell side of that split.
> - **Cancel** tracks the in-flight `execute()` handle at module scope so the
>   Command Palette entry can cancel a run the progress notification's own
>   Cancel button did not originate from. A `reset()` in progress has no
>   handle at all; the only way the seam lets a caller interrupt one is
>   `ExecutionBackend.close()`, which also disconnects — made safe to do
>   from underneath a later run by having the per-profile backend cache always
>   re-call the (idempotent, I/O-free) `connect()` before handing a cached
>   backend back out.
> - Text-only, per this slice's own plan text: `text/html` and `image/png`
>   outputs get one localised "produced, not yet viewable" line each rather
>   than being dumped as markup or base64; a structured traceback is not
>   re-rendered at all, because the raw traceback text is already visible as
>   plain log output by the time a caller sees it (`logFilter.ts`'s
>   `isNoiseLine` never excluded `error`/`normal`).
>
> **Adversarial subagent review, before this was proposed** — this slice adds
> source and a documented invariant (ADR-0011's execution), the bar this
> project's standing policy sets for the review. It found three real defects,
> all fixed in the same change rather than left for a round trip:
> 1. `backendFor()` would silently orphan a still-running backend if a
>    reconnect (a new `ComputeConnection` for the same profile) landed while
>    a `reset()` was in flight on the old one — the cache entry was
>    overwritten unconditionally. Fixed: the outgoing backend is closed first
>    if it is busy.
> 2. `cancelRun`'s reset-interrupt fallback scanned every cached backend and
>    closed the first busy one it found, so a Cancel invoked while parked on
>    one profile could reach in and stop a run on a different one the window
>    had used earlier. Fixed: scoped to the currently active profile's own
>    cached backend.
> 3. The run's own progress notification was `ProgressLocation.Window` with
>    `cancellable: true` — VS Code's own contract is that only
>    `ProgressLocation.Notification` renders a cancel button, so the wiring
>    was dead from the UI's side; only the Command Palette's `Cancel` command
>    could ever have reached it. Fixed: moved to `Notification`, which is now
>    also the reason `showProgress`'s helper (renamed from
>    `withWindowProgress`) takes a location rather than assuming one.
>
> **What is still open, deliberately not closed by this slice:**
> - ~~`src/profile/statusBar.ts` itself still needs deleting.~~ **Done**,
>   alongside dropping its `.c8rc.json` exclude line — both in the commit
>   that opened PR #63, once outside the sandbox that could not delete files
>   on the mounted working tree.
> - ~~Run by hand, 2026-08-26 — and the result is the bad one.~~ **Resolved the
>   same day, by [ADR-0020](../adr/0020-run-target-defaults-to-local.md).**
>   This extension's own **Run File** came up as the *primary*
>   `editor/title/run` button, ahead of `ms-python.python`'s **Run Python
>   File**, on a folder where `pythonOnViya.runFile` had never once been
>   invoked before — not "last used remembered" (there was no prior use to
>   remember), something else in how VS Code orders these contributions
>   favoured ours. Precisely the "claim the play button by accident" outcome
>   ADR-0011 said would mean revisiting the ADR, not working around it — and
>   ADR-0020 is that revision: the run target now defaults to `"local"`, so an
>   unconfigured workspace contributes nothing to the editor at all, and this
>   extension's entry can only win the primary slot once a user has
>   explicitly switched to Viya. See the procedure and its findings just
>   below for the full record.
> - **No keybinding**, unchanged from the ADR — still an open item, not a gap.
> - A full run's actual streaming end to end is exercised by
>   `proc-python-backend.test.ts`'s own unit suite (already covering
>   `ProcPythonBackend` directly) and by `test/integration/run/commands.test.ts`'s
>   guard-path coverage (refusals, `selectRunTarget`'s store writes) — not by a
>   second, hand-built fake Compute transport driven through the commands layer
>   itself. Worth a live test in a later slice if a defect ever turns up between
>   the two tiers that neither currently catches.
> - No user-facing page describes the run target or these commands yet — the
>   pattern `connecting.md`/`signing-in.md`/`connection-profiles.md` already
>   set at the top of `docs/` is where one would go. The CHANGELOG entry is the
>   only user-facing writeup today; user documentation proper is 5c's job.
>
> **Manual test for ADR-0011's "confirm by hand" assumption, run 2026-08-26.**
> How VS Code presents this extension's `editor/title/run` entry when another
> extension contributes to the same menu — specifically `ms-python.python`,
> the collision ADR-0011 names in its own "The collision" section — had never
> been observed, only asserted from the contribution point's documented shape.
> Nothing below is reachable from an automated test: it needs a real running
> Extension Development Host with a second extension installed in it.
>
> **Setting up.** Open the repo in VS Code and press `F5` — the *Run
> Extension* launch configuration builds first and opens an Extension
> Development Host. In the dev host, open (or create) a trusted folder
> containing a `.py` file, and open that file in the editor. Confirm
> `ms-python.python` (Microsoft's Python extension) is installed in that
> window — Extensions view, search "Python", publisher Microsoft — installing
> it first if it is not, since it is the specific collision being checked.
>
> **This note applies from 2026-08-26 onward, after the run below.** The run
> target now defaults to `"local"`
> ([ADR-0020](../adr/0020-run-target-defaults-to-local.md), written because
> of what this very procedure found the first time it was run) — this
> extension contributes nothing to the editor until the target is switched to
> Viya, so a repeat of this procedure needs `Select Run Target` (status bar,
> or the palette) pointed at a configured profile *before* step 1, or there
> is no button to observe at all. The run recorded below predates that
> change: the button appeared with nothing configured, because Viya was
> still the default at the time.
>
> 1. Look at the editor title bar's toolbar, top right of the open `.py` file.
>    **Expected:** note whether exactly one play-shaped icon is visible there,
>    or two separate ones side by side.
> 2. Hover the play icon without clicking it.
>    **Expected:** a tooltip names one command — either **Run Python File**
>    (`ms-python.python`'s) or **Run File** (this extension's). Note which.
> 3. Look for a small chevron immediately to the icon's right.
>    **Expected:** note whether a dropdown arrow is present next to the icon.
> 4. Click the chevron from step 3.
>    **Expected:** a menu opens listing the *other* run command — whichever of
>    **Run Python File** / **Run File** was not named in step 2.
> 5. Click that other command.
>    **Expected:** its own behaviour runs — this extension's **Run File**
>    shows either "The run target is Local Python…" or "No SAS Viya connection
>    profile is selected…", depending on the run target, since no profile is
>    needed to observe the button itself.
> 6. Without reloading the window, look at the toolbar icon again.
>    **Expected:** note whether the tooltip now names the command run in step
>    5 (VS Code promoted the last-used command to primary) or still names the
>    one from step 2 (the primary assignment did not move).
> 7. Repeat steps 2–6 once more, clicking whichever command the chevron offers
>    this time.
>    **Expected:** note whether the primary/secondary assignment settled at
>    step 6 stays put, or keeps moving on every click.
>
> If step 1 shows two icons rather than one with a dropdown, VS Code did not
> merge the two `editor/title/run` contributions at all — a materially
> different finding from what ADR-0011 discusses, and worth its own note
> rather than being forced into steps 3–7. If step 6 or 7 shows this
> extension's **Run File** becoming primary without ever having been the entry
> named in step 2 to begin with, that is the "claim the play button" outcome
> ADR-0011 rejected, arriving by accident — the ADR needs revisiting, not a
> workaround.
>
> **What this run found, 2026-08-26, with `ms-python.python` installed and
> `pythonOnViya.runFile` never previously invoked in this folder:**
> - **Step 1:** one play-shaped icon, not two. VS Code does merge same-group
>   `editor/title/run` contributions into a single button with a dropdown,
>   settling that half of the open question.
> - **Step 2:** the tooltip named **Run File** — this extension's own command
>   — not `ms-python.python`'s **Run Python File**. Confirmed as the *first*
>   thing observed, before any command in this session had been run at all.
> - **Step 3–4:** a chevron was present; opening it listed **Run File** first,
>   then `ms-python.python`'s own entries in order (**Run Python file**, **Run
>   Python file in dedicated terminal**, **Run current file in interactive
>   window**, **Run as task**) followed by its two debugger entries. Matches
>   ADR-0011's own account of what `ms-python.python` contributes to this
>   menu, and confirms VS Code lists every contribution rather than picking a
>   single "other" one.
> - **Step 5–7:** every way of invoking **Run File** tried — the primary
>   button, and selecting **Run File** explicitly from the chevron, tried more
>   than once — ran correctly on the configured Viya profile (`Running
>   test.py on SAS Viya profile "innovation"…`, the program's own output, then
>   `Finished.`), and the primary assignment did not move across repeated
>   invocations. `ms-python.python`'s own **Run Python file** was not
>   exercised this run, so whether *it* would ever displace ours as primary is
>   still unobserved.
>
> **The result is the one ADR-0011 said would need revisiting rather than
> working around.** This extension's entry was primary *from the very first
> observation*, ahead of `ms-python.python`, with no prior invocation in this
> folder to explain it as "last used remembered" — the answer to "which
> becomes the primary button" is not "whichever was used last," at least not
> only that; something about how VS Code orders `editor/title/run`
> contributions favoured this extension's entry by default. That is a
> materially different, and worse, shape than the ADR's own framing
> anticipated: a user who has never touched this extension, on a workspace
> where `pythonOnViya.runTarget` defaults to `"viya"` with no profile
> required for the button to appear at all, can have their editor's play
> button silently mean "run on Viya" the first time they ever open a `.py`
> file. A change to *which* button is primary is an architecture-level
> decision, not a bug fix, so this was recorded and discussed with Sean rather
> than patched on the spot, per this project's "Treat architecture-level
> changes as a deliberate event" policy — the agreed direction is
> [ADR-0020](../adr/0020-run-target-defaults-to-local.md), reversing the
> default to Local, implemented in the same slice once agreed.
>
> **Re-checked by hand, 2026-08-26, in a folder never opened with this
> extension before, after ADR-0020 landed.** Every expectation held: no icon
> from this extension in the editor toolbar with nothing configured (only
> `ms-python.python`'s own **Run Python file**, no dropdown); `Python on Viya:
> Run File` from the Command Palette still reported "The run target is Local
> Python. Switch the run target to a SAS Viya profile to run this on Viya."
> exactly as always; `Select Run Target` listed **Local Python** plus both
> configured profiles; picking **innovation** made this extension's **Run
> File** appear, merged with `ms-python.python`'s into one button with a
> dropdown, and running it connected and executed correctly. One false alarm
> along the way worth recording verbatim, because it will recur: clicking the
> *notification toast* that names a refusal ("Source: Python on Viya…", the
> one with a gear/chevron/`X`, sitting in the bottom-right corner of the
> editor) does nothing, and is easy to mistake for "the status bar" — the
> actual status bar switch is the solid bar along the very bottom edge of the
> whole window, where this extension's item sits left-aligned, just after the
> problem counts (`$(server) innovation` once a profile is picked). Clicking
> *that* opened the picker correctly the first time it was tried once the
> right element was identified.
>
> **Two more defects, found running `npm run test:integration` against a real
> test host after this slice was proposed — not caught by the adversarial
> review above, which reads the diff rather than running it:**
> 1. `test/integration/run/commands.test.ts` called `registerRunCommands`
>    itself with its own fakes, which tries to claim `pythonOnViya.runFile`
>    and the other four ids on the process-global `vscode.commands` registry —
>    but the real extension had already claimed them at activation
>    (`onStartupFinished` fires before any test body runs), so every one of
>    the suite's eight tests failed with "command already exists," regardless
>    of `afterEach` disposal. Every other command-test file in this repo
>    avoids the collision by driving the already-activated real extension
>    through `executeCommand` instead of re-registering. Fixed by giving
>    `commands.ts` a `createRunCommandHandlers` export — the same five
>    handlers, built with the caller's fakes, with no
>    `vscode.commands.registerCommand` call among them; `registerRunCommands`
>    is now the thin shell that wires those handlers to the real registry
>    exactly once, and the test calls the handlers directly.
> 2. Once that collision was fixed and the suite could actually run,
>    `buildProgram` in `commands.ts` turned out to send **Run Selection with an
>    empty selection to run the whole file** rather than reporting "Select
>    some code to run" — `if (selection === undefined || selection.isEmpty)`
>    folded "Run File's own deliberate `undefined`" and "Run Selection's own
>    empty `Selection` object" into the same whole-document branch, contrary
>    to what the function's doc comment already said. Fixed: only
>    `selection === undefined` falls back to the whole document; a
>    defined-but-empty selection now returns `undefined`. Caught by the guard
>    test named for exactly this case, once it could run past the collision
>    above.
>
> **PR #63's own review found three more, all fixed in the same PR rather
> than a round trip:**
> 1. **Blocking (Claude Bot).** `package.json`'s `contributes.commands` entries
>    for `runFile`, `runSelection` and `resetPythonState` carried
>    `enablement: "editorLangId == python && pythonOnViya.runTarget == viya &&
>    isWorkspaceTrusted"` (`runSelection` also `&& editorHasSelection`) — but
>    `enablement` governs the command everywhere it can be invoked, the
>    Command Palette included, not just the editor placements it was copied
>    from. That directly contradicts ADR-0011's Consequences section, "the
>    palette command never disappears," and its Decision section, "the target
>    governs placement, never meaning, so no gesture changes what it does
>    under the user's hands." Fixed: the clause stays only on the
>    `editor/title/run` and `editor/context` menu entries, where it already
>    correctly gates placement; the three commands now carry no
>    `enablement` at all (`cancelRun`'s own `pythonOnViya.running` gate is
>    unrelated — it is not flagged and is left alone). The guard tests
>    already covered every case this now makes reachable from the palette
>    (no editor, empty selection, wrong target) — they exist because the
>    behaviour was always meant to be hit this way, just never actually
>    reachable through the entry point that matters.
> 2. **Major (Codex).** `cancelRun`'s reset-interrupt fallback (the fix for
>    finding 2 in the adversarial review above) re-derived "the busy backend"
>    from `targets.status()` — the *currently active* profile — at the moment
>    Cancel was pressed. That fixed the original "close whichever cached
>    backend happens to be busy" bug, but broke as soon as the run target or
>    active profile changed while the reset was still in flight: the
>    fallback would then look at the wrong profile's cache entry, or none,
>    and tell the user nothing was running while the reset kept going
>    regardless — `pythonOnViya.running` stayed `true` and the progress
>    notification kept spinning throughout. Fixed properly this time:
>    `resetPythonState` now tracks the backend a reset is running on directly
>    (`currentReset`, the same shape `currentRun` already used for
>    `execute()`), and `cancelRun` checks it first. The profile-scanning
>    fallback is gone entirely — it was a workaround for `reset()` returning
>    no handle, not a design constraint, and tracking the backend directly in
>    `commands.ts` sidesteps the need for it.
> 3. **Minor (Claude Bot) — correct about the message, wrong to remove the
>    check; caught by a second review pass before this landed.** `runNow` and
>    `resetPythonState` each pre-checked `backend.busy` and, if true, reported
>    a synthesized `{ code: "busy", running: "a run in this window" }` — and
>    `localiseBackendProblem`'s `busy` arm does ignore `running` by its own
>    design, so that value really is write-only, exactly as flagged. The first
>    fix removed both pre-checks on that basis, reasoning that `execute()`/
>    `reset()`'s own `busy` refusal a few lines below would produce the same
>    user-visible message. A follow-up adversarial-review pass over that fix
>    found it wrong: the check's real job was never the message, it was
>    stopping a second invocation from ever reaching `syncRunningContext`,
>    `currentRun`/`currentReset` and the shared `finally` below. Without it, a
>    second `Run File` (or `Reset Python State`) fired while the first was
>    still executing would pass through, get correctly refused as busy by
>    `execute()`/`reset()` itself, but its own `finally` would still
>    unconditionally clear the *first*, still-running invocation's tracking —
>    reintroducing, for `currentRun`, the same class of bug finding 2 above
>    fixed for `currentReset`. Both checks are back, with a comment explaining
>    the serialisation reason rather than the (true, but incomplete) messaging
>    one the review gave.
> 4. **Minor/non-blocking (Claude Bot), on a later round.** `createRunCommandHandlers`'s
>    `dispose()` tore down `targetChangeSubscription` and the output channel
>    but never touched the `backends` cache — a still-busy `ProcPythonBackend`
>    was simply dropped on window close, with no comment explaining why that
>    is fine, unlike `ComputeSessionManager.dispose()`'s own explicit
>    reasoning for the equivalent decision. Unlike that case, there genuinely
>    is something worth attempting here: `close()` sends a real interrupt for
>    whatever a backend has active. Fixed with the sweep the review offered
>    as the alternative to a comment alone — `dispose()` now calls
>    `close()` on every cached backend, fired and not awaited for the same
>    reason `ComputeSessionManager.dispose()` does not join an in-flight
>    `connect()`: synchronous, the window is closing regardless, and there is
>    nowhere to await it that VS Code would honour. `close()`'s own contract
>    makes this safe to call whether or not a given backend is actually busy.

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

☑ **3d-ii — the result panel webview.** Merged as
[PR #65](https://github.com/Shai-Alit/sas-py-vscode/pull/65), 2026-08-27.
[ADR-0021](../adr/0021-result-panel-webview.md) settles the
mechanism (a singleton `WebviewPanel`, CSP-locked, a buffered host↔webview
message protocol) and every wire-level decision (the reveal policy, the
localisation boundary, how the browser-only bundle is tested); this is the
punch list for what was actually written against it, including the review
that happened before and after the PR opened.

- **`src/run/resultPanelModel.ts` (new, pure).** Reduces one streamed
  `RichOutput` to a `RenderItem` — total over the mime union, unlike
  `render.ts`'s `renderRichOutput`, which defers two arms and drops a fifth.
  Also declares `ResultPanelMessage`, the one shared wire type both sides of
  the host↔webview boundary import, and `isResultPanelMessage`/`isRenderItem`,
  the runtime validation that closes `SECURITY.md`'s "unvalidated messages
  crossing the extension/webview boundary" line item for this feature. Never
  invents English text of its own — every localised string arrives as a
  parameter, already translated by `resultPanel.ts`.
- **`src/run/resultPanelDom.ts` (new, pure — no `vscode`, no DOM lib).**
  Applies a `ResultPanelMessage` to a document expressed against `DomPort`,
  this module's own small interface rather than `lib.dom.d.ts`'s real
  `HTMLElement` — which is exactly why it needs no `tsconfig.webview.json` and
  stays inside the ordinary unit tier and the coverage denominator, unlike the
  one file that actually runs in a browser. Accessibility decisions live here:
  an image's `alt` comes from the `RenderItem` it was handed; `text/html`
  output is inserted as markup so a pandas table's own `<table>` survives as a
  real table; a traceback becomes a heading, a message paragraph and a genuine
  ordered list of frames.
- **`src/webview/entry.ts` (new — this feature's only file under
  `src/webview/`).** The literal browser bootstrap ADR-0021 describes:
  `acquireVsCodeApi()`, a thin `DomPort` forwarding straight to the real
  `document`, and a `message` listener wired to `resultPanelDom.ts`'s
  `applyMessage`. No branch of its own worth testing that a test of the two
  modules above would not already catch — excluded from coverage by the new
  `isBrowserOnly` rule, not because it is untested but because
  `acquireVsCodeApi`/`document` do not exist under the unit tier's Node
  process.
- **`src/run/resultPanel.ts` (new — the one `vscode`-importing module in this
  feature).** Owns the `WebviewPanel`: creation, the CSP/nonce'd HTML shell,
  the `"ready"`-handshake message buffer, and every `vscode.l10n.t()` call this
  feature makes. Implements the reveal policy — opens and reveals the panel
  only the first time a run's output is not already fully visible as
  `text/plain` in the output channel; an outcome or a failure alone never
  opens it either. `ResultWebviewPanel` narrows `vscode.WebviewPanel`/
  `vscode.Webview` to the six members this class actually calls, the same
  narrowing shape `RunCommandSessions` already uses for
  `ComputeSessionManager`, so `test/integration/run/result-panel.test.ts`'s
  fake only has to implement those six.
- **`src/run/commands.ts` wired to call it** — `resultPanel.startRun()`
  alongside `outputChannel.writeRunHeader`, `resultPanel.writeOutput` added to
  `drainOutputs`, `resultPanel.writeOutcome`/`writeFailure` alongside the
  output channel's own. `createRunCommandHandlers` gained a new required
  `extensionUri` parameter (needed to build the panel's webview URIs) between
  `log` and `deps`; `registerRunCommands` passes `context.extensionUri`
  through. `resetPythonState` is deliberately **not** wired to the panel — a
  reset produces no `RichOutput` for it to show.
- **Build config, touched for the first time in this repository:**
  `tsconfig.webview.json` (DOM lib, no `vscode`/Node types, scoped to
  `src/webview/**`), `src/webview/**` excluded from `tsconfig.json` and
  `tsconfig.test.json`'s own `include`, a second browser-target `esbuild`
  context in `esbuild.mjs` (`dist/webview/resultPanel.js`), a matching
  `eslint.config.mjs` block (`project: ["./tsconfig.webview.json"]`,
  `globals.browser`), and `npm run typecheck` gained a third `tsc` invocation.
- **`check-coverage-scope.mjs` gained a third exemption**, `isBrowserOnly` —
  checked bidirectionally the same as the other two, and its own unit tests
  extended in `test/unit/coverage-scope.test.ts`. `.c8rc.json` gained
  `src/run/resultPanel.ts` (imports `vscode`) and `src/webview/entry.ts`
  (browser-only) to its exclude list.
- **Test plan, matching the shape a new pure module plus a new shell module
  already takes elsewhere in this repo:**
  - `test/unit/result-panel-model.test.ts` — `toRenderItem` over every mime
    arm, the image-numbering contract, `isRenderItem`/`isResultPanelMessage`'s
    accept and reject cases, `outcomeMessage`.
  - `test/unit/result-panel-dom.test.ts` — `applyMessage` against a fake
    `DomPort` that records what was asked of it: every `RenderItem` kind, the
    outcome/failure arms, and a short sequence proving `"reset"` does not
    disturb what comes after it.
  - `test/integration/run/result-panel.test.ts` — `ResultPanel` against a
    fake `ResultWebviewPanel`: the reveal policy for all three rich mimes and
    its absence for text-only/outcome-only/failure-only, the CSP nonce
    matching between the meta tag and the script tag, the ready-handshake
    buffer-then-replay, and disposal.
  - No live test and no change to `test/integration/run/commands.test.ts`'s
    own guard-path scope — that suite's `sessionsThatMustNotConnect()` fakes
    mean `ResultPanel.writeOutput` is never reached from it, matching the
    already-recorded gap in 3d-i's own punch list about this suite's limits.
- **What is still open, deliberately not closed by this slice:** no
  interactive surface on the panel itself (copying an image, jumping from a
  traceback frame to its source line — the latter is Phase 4's per
  `backend.ts`'s own doc); no `WebviewPanelSerializer`, so a window reload
  loses the panel's content exactly as it already loses the output channel's
  scrollback; the coverage ratchet in `.c8rc.json` is **not** re-baselined in
  this draft — measuring it needs `npm run coverage`, which this session does
  not run, per this project's standing rule.
- **Adversarial subagent review, before this was proposed.** Found two real
  defects and three documentation gaps, all fixed in the same change rather
  than left for a round trip:
  1. **Major.** `ResultPanel.writeOutput` only ever called `.reveal()` on the
     run that happened to *create* the panel — a panel left open but
     unfocused from an earlier run never came back to front for a later
     run's own qualifying output, contradicting ADR-0021's own per-run
     wording. Fixed with a `revealedThisRun` flag, reset in `startRun()`,
     that reveals an already-existing panel explicitly rather than only ever
     doing so inside panel creation. Regression test added to
     `result-panel.test.ts`.
  2. **Worth documenting, not a live bug once traced through.** The review
     asked whether replaying the whole backlog on every `"ready"` — with no
     guard on `this.ready` already being `true` — could double-post content
     if `"ready"` ever arrived twice against a still-populated DOM. Verified
     it cannot: a `"ready"` can only originate from `entry.ts`'s top-level
     script running, which only happens when the webview's document loads or
     reloads, and `retainContextWhenHidden: false` (now set explicitly rather
     than left as an implicit default) guarantees a hide/show cycle *is*
     such a reload — so every `"ready"` this design will ever see already
     corresponds to an empty document. Documented in both `resultPanel.ts`
     (at the handler) and ADR-0021 itself, since the reasoning was previously
     implicit rather than written down anywhere a later change to
     `retainContextWhenHidden` would see it.
  3. **Minor.** A comment added to `tsconfig.test.json` in this same slice
     named a path, `src/webview/dom/`, that was an earlier draft's layout
     and does not exist in what actually shipped (`src/run/resultPanelDom.ts`
     is where that logic lives, precisely so it stays outside `src/webview/`
     and inside the coverage denominator — see ADR-0021's own layer-2
     reasoning). Corrected.
  4. **Minor.** `resultPanelModel.ts`'s doc comment on `isRenderItem`/
     `isResultPanelMessage` claimed "both sides" of the host↔webview boundary
     now validate incoming messages; only the host-to-webview direction
     actually does (the other direction has no vocabulary beyond the single
     `"ready"` signal, checked by `resultPanel.ts`'s own narrow guard).
     Reworded to say precisely that.

- **`npm run verify`, run by Sean on his own machine (this session's sandbox
  cannot run ESLint or the real esbuild build), found two real problems the
  subagent pass above could not — neither is an ESLint config gap, both are
  this diff's own defects:**
  1. `src/run/resultPanel.ts` imported `randomUUID` from `node:crypto` for
     the CSP nonce, which `no-restricted-imports` correctly refused —
     ADR-0003's Node-builtins ban applies here and this file was never added
     to the three-file allow-list. Fixed by using the Web Crypto global
     (`crypto.randomUUID()`) instead of the Node-specific import: it needs no
     import at all, resolves to the same standard API a browser exposes, and
     keeps working unchanged in a hypothetical future web extension host —
     strictly better than widening the allow-list for a case that does not
     need it.
  2. `test/unit/result-panel-dom.test.ts` (and one call site in
     `result-panel.test.ts`) destructured a value out of an array
     (`const [child] = root.children`) and then optionally-chained off it
     (`child?.text`), which `@typescript-eslint/no-unnecessary-condition`
     flagged. First fix attempt (below) diagnosed this as a
     destructuring-vs-bracket-indexing gap and was wrong — recorded as
     corrected in the next entry rather than edited away, since the mistake
     and what it took to actually find the real cause are worth keeping.

- **That fix did not hold.** Sean's second `npm run verify` run reported the
  same class of errors again, at shifted line numbers, plus one new one
  (`@typescript-eslint/prefer-find`) the first fix had introduced. Rather than
  theorise a second time, this was checked empirically: a throwaway file with
  the same shape, compiled directly with `tsc --noEmit --noUncheckedIndexedAccess`
  outside this repo's own config, confirmed `noUncheckedIndexedAccess` widens
  a bracket-indexed read (`root.children[0]`) to `T | undefined` regardless of
  whether it is destructured or stored in a `const` first — the original
  diagnosis of *why* the first errors appeared was wrong from the start, not
  just incompletely fixed. What actually explains which specific `?.` chains
  `no-unnecessary-condition` flags, on a variable whose type genuinely is
  `T | undefined`, was not fully resolved (the rule's verdict on `x?.y` did
  not depend solely on `x`'s nullability in the cases observed — e.g.
  `root.children[0]?.tag` went unflagged next to `root.children[0]?.text`
  flagged, both on the same expression) — pursuing that further stopped being
  worth it once a strictly better fix was available:
  `assert.ok(child)` (an `asserts value` signature in `@types/node`) narrows
  the variable to non-`undefined` for TypeScript once, up front, so every
  property read after it is a plain `.`, with no optional chain left for the
  rule to misjudge either way. This is also a strictly better test: the old
  `child?.text` pattern let a test comparing "is text undefined" pass
  vacuously if `applyMessage` had failed to append a child at all; the
  `assert.ok` guard fails loudly in that case instead. Applied throughout
  `result-panel-dom.test.ts`. The second, unrelated new error
  (`@typescript-eslint/prefer-find` on `.filter(isOutcomeMessage)[0]` in
  `result-panel.test.ts`, introduced by the first fix attempt's own
  `.filter(...)[0]` rewrite) was fixed by using `.find(isOutcomeMessage)`
  instead, which returns the same `T | undefined` the existing `assert.ok`
  guard already expected. Re-verified with `tsc --noEmit` (three configs) and
  `prettier --check` on both files — clean — but ESLint itself still has not
  been run in this session on this fix; that is Sean's next `npm run verify`
  to confirm.

- **That `npm run verify` (1085 passing, ESLint and the real test suites
  both green) found one more failure — not in this feature's own code, but a
  regression the `isBrowserOnly` edit above introduced in a pre-existing
  test.** `check-coverage-scope.test.ts`'s `"catches a types file that has
  grown code, still excluded"` asserts the exclude-verification error message
  matches `/has code to run/`. Adding the browser-only clause to that shared
  message (`", is not types only, and is not under \"src/webview/\""`)
  dropped the original text's literal `"has code to run"` phrase the test
  depends on, entirely by accident — the rewritten sentence said the same
  thing with different words. Fixed by keeping the added clauses and putting
  the phrase back (`"— so it has code to run and the unit tier can reach
  it"`), rather than loosening the test's assertion to match the new
  wording, since nothing about this message actually needed to stop saying
  that. Re-verified with `tsc --noEmit` and `prettier --check` — clean. This
  is the only failure `npm run verify` found in this round; the fix is
  narrow enough (one string literal) that a third verify run should confirm
  a clean pass.

- **That third `npm run verify` passed clean, and `npm run test:integration`
  — the real VS Code host, not the mocked `vscode` module — surfaced a real
  bug this feature's own review had not: `.mocharc.json`'s `spec` is
  `out/test/unit/**/*.test.js` only, so `test/integration/**` (including
  `test/integration/run/result-panel.test.ts`) had never actually executed
  before this run.** The failure it found —
  `"disposes the underlying panel, and a run after disposal opens a new one"`
  — traced to a real gap, not a test artefact: `revealedThisRun` was reset
  in `startRun()` but never on panel disposal, and a user closing the panel
  tab fires the identical `onDidDispose` event `ResultPanel.dispose()` does.
  A user who closed the panel mid-run had permanently used up that run's one
  reveal — any further rich output later in the same run would never bring a
  panel back. Fixed by also resetting `revealedThisRun = false` inside
  `open()`'s `onDidDispose` handler (`src/run/resultPanel.ts`). A second,
  scoped adversarial review of just this change (the full slice had already
  had one) found the fix correct and complete for the stated bug, no race
  condition (the reset runs synchronously in the same tick as the rest of
  disposal cleanup), and one real but non-blocking asymmetry the first
  version of the explanatory comment glossed over: `ResultPanel.dispose()`
  only ever runs from extension teardown, where `close()` on a still-busy
  backend is fired, not awaited, so a straggling `writeOutput` can in
  principle land after this handler runs and now resurrect a panel during
  shutdown — an exposure that already existed before this fix for a run that
  had not revealed yet, just widened to one that already had. Not worth
  guarding against (VS Code is already tearing the extension host down
  either way), but the comment now says so explicitly rather than implying
  the two disposal causes are equivalent. Re-verified with `tsc --noEmit`
  (both configs touched) and `prettier --check` — clean.

- **`npm run test:integration`, re-run against the real VS Code host with the
  fix in place: 193 passing, including the one that had failed** (`ResultPanel`
  `"disposes the underlying panel, and a run after disposal opens a new one"`)
  **and the rest of `test/integration/**`, exercised for the first time this
  phase now that a real bug proved the mocked `vscode` tier alone was not
  enough.** `npm run verify` (lint, typecheck, unit/coverage tier, contracts,
  build) and `npm run test:integration` (the real host) have now both passed
  clean against the same diff. `npm run check:docs` — covering the VitePress
  build and ADR listing over the new `docs/adr/0021-result-panel-webview.md`
  and the `docs/adr/README.md` row pointing at it — has not yet been run and
  is the one remaining check before 3d-ii is ready to merge.

- **`npm run check:docs` passed clean.** `npm run verify`, `npm run
  test:integration`, and `npm run check:docs` all pass on the finished diff —
  this slice's own checks are done. What's left is Sean's own manual review
  of the diff and the commit/PR itself; the checkbox above ticks once this
  actually merges, matching how 3d-i's entry recorded it.

- **Sean's manual review of the diff, 2026-08-27 — four points, all fixed in
  the same diff, none of them behaviour regressions:**
  1. **l10n boundary hole.** `resultPanelDom.ts` built each traceback frame
     line as `` `${file}, line ${line}, in ${name}` `` — "line" and "in" are
     English prose emitted from the pure DOM layer, contradicting ADR-0021's
     rule that every user-facing string is finished host-side by
     `vscode.l10n.t()`. Fixed by adding `tracebackFrame` to `RenderItemLabels`
     (a per-frame formatter, only invoked for a traceback output, like
     `tracebackHeading`); `resultPanel.ts` supplies it as
     `l10n.t("{0}, line {1}, in {2}", …)`. The traceback `RenderItem` now
     carries `frameLines: readonly string[]` (already formatted) instead of
     structured `frames` — the DOM layer only ever rendered a frame as one
     `<li>` of text, and structured file/line/name has no consumer until
     Phase 4's traceback-to-editor mapping, which ADR-0021 already defers and
     which will shape its own message then. `isRenderItem` validates
     `frameLines` via the existing `isStringArray`; `isRenderTracebackFrame`
     is gone. Tests in all three files updated.
  2. **Unbounded per-run backlog retention.** `ResultPanel.emit()` keeps
     every message of a run — including every `text/plain` chunk of a run
     that never opens a panel — until the next `startRun()`. It has to: a
     `retainContextWhenHidden: false` panel replays the whole backlog on
     every hide/show reload. Left as-is by design; the `backlog` field's doc
     comment now states the retention cost explicitly and records that a
     size-aware cap (which would cost full-run fidelity on a reloaded or
     late-opening panel) is a deliberate non-goal, not an oversight.
  3. **`<html lang="en">` hardcoded** in the panel shell while its own
     strings are localised. Now set from `vscode.env.language` (filtered to
     the documented BCP-47 shape, `"en"` fallback) so a screen reader
     announces localised content in the right voice.
  4. **`tsconfig.webview.json` comment** claimed "a file is compiled under
     exactly one of these type spaces" — true for `src/webview/**`, but the
     two `src/run/` files it also lists are deliberately checked under both
     it and `tsconfig.json`, which is what proves they stay DOM-free and
     `vscode`-free. Comment corrected to say that.

  Re-verified locally with `tsc --noEmit` (all three configs) and
  `prettier --check`. Sean re-ran `npm run verify` (1086 passing, 93.76%
  coverage) and `npm run test:integration` against the finished diff — both
  clean. Adversarial review, `verify`, `test:integration`, and `check:docs`
  have all now passed on this exact diff.

- **AI reviewers on the PR raised two more, 2026-08-27 — one dismissed, one
  turned into an explicit recorded exception:**
  1. **CodeQL — "missing origin verification in `postMessage` handler"
     (Medium).** Dismissed as a scanner false-positive for this context, not
     code-changed. The only route for hostile content into the panel is a
     `text/html` output, and the CSP (`script-src 'nonce-…'`, `default-src
     'none'` so no child frames) leaves it inert — there is no script and no
     foreign frame able to post a message at all, and `entry.ts` already
     shape-validates every message with `isResultPanelMessage`. VS Code's own
     webview samples do not origin-check the receive side, and a naive
     `event.origin` check risks silently blanking the panel given
     sandboxed-webview origin semantics differ desktop vs `vscode.dev`.
     `SECURITY.md`'s "reports produced solely by an automated scanner with no
     demonstrated impact" clause covers it.
  2. **LLM review bot — `style-src 'unsafe-inline'` called "blocking".** The
     bot's stated rationale ("inline styles execute", "inline injection
     surface") is wrong — `style-src` governs whether CSS *applies*, not code
     execution, and `script-src` is nonce-only. Decision (Sean): keep
     `'unsafe-inline'` for full pandas fidelity — `to_html()`'s inline
     attribute and the Styler's generated `<style>` element both need it, and
     the alternative (nonce our own `<style>`, drop the allowance) buys a
     scanner-clean line at the cost of unformatted `DataFrame` output for a
     threat (CSS-only restyle of a read-only panel, no exfil sink under
     `default-src 'none'` + `data:`-only `img-src`) that does not justify it.
     Made explicit rather than left to re-litigate: ADR-0021's
     "Content-security policy" section now carries the full analysis and the
     rejected alternative, `SECURITY.md`'s webview bullet points a reporter
     there and scopes scanner-only reports out, and
     `result-panel.test.ts` now asserts the `style-src` allowance *and* the
     `script-src` non-allowance together so removing either trips a test that
     names the ADR.

☑ **3e — ship the package list as a user-facing thing, not a capability record.**
Merged as [PR #67](https://github.com/Shai-Alit/sas-py-vscode/pull/67),
2026-08-27 — this is the punch list for what was actually written, including
the review that happened before and after the PR opened: two in-session
adversarial passes, an independent senior-review pass, and the automated PR
reviewer, each with its own dedicated bullet below.

The person writing code in this editor is writing against an interpreter they
cannot see, on a machine they cannot log into, whose package set someone else
chose and can change without telling them. Worse, the local environment lies
with conviction: Pylance resolves `import polars` against the laptop, so the
editor is green and the run is a `ModuleNotFoundError`. `PRODUCTION_PLAN.md`
§2.3 and this phase's own plan text.

- **A real design fork, settled before any code, per this project's own
  "treat architecture-level changes as a deliberate event":** should the
  stage-2 probe live on `ExecutionBackend` itself (widening
  `BackendCapabilities.runtime` from the `"unprobed"`-only type 2b-i left it
  as, and adding a new `probeRuntime()` method a future native backend would
  also have to implement), or as a separate Viya-specific module that reaches
  past the seam to `ComputeConnection`/`compute/files.ts` directly, the way
  `commands.ts` already does for the run/reset backend cache? Settled on the
  seam: `capabilities()` describing what a backend actually knows about
  itself is the whole point of `BackendCapabilities`, and a parallel channel
  for exactly the same kind of fact would be a second thing a future backend
  has to satisfy on its own terms rather than one interface. This is the same
  bar 3c-i's ADR-0019 and 3d-ii's ADR-0021 were held to; it does not get its
  own ADR file, the same call 3c-ii made for a scope decision rather than a
  competing design — but it is recorded here in full rather than only in a
  commit message.
- **`backend.ts`'s own `capabilities()` doc corrected.** It used to say
  "probing happens in `connect()`" — written before 3e existed, and wrong for
  what 3e actually needed: probing a full package list on every reconnect
  would tax every run, and this phase's own plan text calls for an
  **explicit** refresh precisely because the answer is slow and rarely
  changes. `probeRuntime()` is now documented as the only way
  `BackendCapabilities.runtime` ever leaves `"unprobed"`.
- **The transport mechanism is not a new finding — it is finding 62,
  applied.** A naive implementation would `print(json.dumps(info))` and
  reassemble the answer from the log the way ordinary program output already
  works. Finding 62 (2026-08-25, 3c-i's own probe) already measured that the
  log hard-wraps any single `print()` line at `LINESIZE` (132 by default, 256
  with `LINESIZE=MAX` — raised, never removed) with **no marker
  distinguishing a wrapped continuation from a genuine new line**, and
  concluded that conclusion holds for "any payload a naive implementation
  prints and expects back as one unbroken string." A package list long enough
  to matter (259 packages, ~6.9 KB of JSON, measured against `verde`) is
  exactly that shape. So `src/backend/environment.ts`'s probe writes its
  answer to a file in the session's working directory instead, fetched
  byte-for-byte via the same `compute/files.ts` finding 61/65/67 already
  built for 3c-i's matplotlib/pandas capture — reusing already-reviewed
  transport rather than inventing a second one. This was independently
  re-verified live against `verde` before writing any code (a `print()` of
  300 non-whitespace characters wrapped 132+132+36; `LINESIZE=MAX` raised it
  to 256+44, never removing the wrap) — the same numbers finding 62 already
  recorded, so nothing new is added to the Probe findings section below.
- **`src/backend/environment.ts` (new, pure — no `vscode`).** The probe's
  fixed Python source (`environmentProbeStatements`) and the parser for what
  it writes back (`parseEnvironmentProbeFile`). The whole probe is wrapped in
  a single function, called from a `try`/`finally` that `del`s its name —
  `import sys, json, importlib.metadata` included, since they are bound inside
  the function body — because `ExecuteOptions.freshNamespace: true`
  cannot be used here (it means `proc python restart;`, destroying the very
  interpreter state a capability probe must not touch), so the probe runs in
  the session's own long-lived namespace and would otherwise leave `sys`,
  `json` and `importlib` bound there as a side effect of merely asking a
  question; the `finally` means a probe that raises still cleans up after
  itself. A distribution whose `METADATA` is too broken to yield a string
  name and a string version is skipped rather than allowed to fail the whole
  run (see the follow-up-review bullet below). `importlib.metadata.distributions()`,
  never `pip` — `pip` need not exist in a compute context at all.
- **`ProcPythonBackend.probeRuntime()` (new).** Submits the probe's fixed
  statements directly via `createJob`, the same shape `reset()`'s
  `RESTART_STATEMENT` already takes rather than `runProgram`'s fileref
  upload — this text is entirely this project's own, never user input, so
  ADR-0014's upload/`infile=` discipline has nothing to say about it. Drains
  its own log (the answer is the file it wrote, not anything printed), reads
  `SYSCC` the same way `execute()`/`reset()` do (ADR-0014/finding 33: a
  terminal job is not proof anything ran), lists the working directory once
  (not the before/after pair `captureRichOutput` needs, since there is only
  ever one candidate name), fetches and deletes its own file via
  `compute/files.ts`, and parses it. A non-zero `SYSCC` is reported as
  `runtime-unavailable` — the one case `procPython.ts`'s own doc says this
  backend does report it, since the probe is this project's own fixed,
  already-verified-against-`verde` script and a failure is read as evidence
  about the runtime rather than a bug to recover from (still not a
  measurement of what an actually-missing `PROC PYTHON` looks like on the
  wire; no such deployment has ever been available to this project). Shares
  `execute()`/`reset()`'s serial contract via the same `SubmissionGuard`, and
  is stopped by `close()` the same way a `reset()` is (a new
  `probeController`, folded into `isCurrentRunAborted()`).
- **`src/run/environmentStore.ts` (new).** The persisted, per-profile cache
  `PRODUCTION_PLAN.md` §2.3 asks for — `globalState`, not `workspaceState`,
  matching `profile/store.ts`'s own reasoning for `SECRETLESS_IDS_KEY`: a
  profile's interpreter version is a fact about the profile, not the
  workspace open right now. Keyed on profile id, never name. No automatic
  expiry and no wiring to profile deletion yet (`forget()` exists and is
  correct, but nothing calls it) — a small, deliberate, documented gap rather
  than a cross-module change to `profile/commands.ts` this slice's own size
  does not warrant.
- **`src/run/environmentDocument.ts` (new, pure) and `src/run/environmentPanel.ts`
  (new — the one `vscode`-importing module for this feature).** Same
  l10n-boundary split `resultPanelDom.ts`/`resultPanel.ts` draw: the pure
  module arranges already-translated labels into a plain-text body, and the
  panel module supplies the translations and owns the
  `vscode.TextDocumentContentProvider`. **Plain text, not Markdown** — a
  read-only virtual document was chosen over a second webview specifically
  for its editor affordances (search, split view) at a fraction of a
  webview's cost, and Markdown buys nothing further on top of that choice for
  a list, not prose. The provider looks up the store **live** on every
  `provideTextDocumentContent` call, which is what lets `refresh()` make an
  already-open tab show a freshly probed answer with the standard
  `onDidChange` mechanism rather than a bespoke one.
- **`src/run/commands.ts` wired to call it** — `showEnvironment`/
  `refreshEnvironment` share one body (`forceProbe: boolean`) reusing the
  existing `backendFor()`/`targets.readiness()`/`reportNotReady` machinery
  `runNow`/`resetPythonState` already have. No `pythonOnViya.running`/Cancel
  wiring: a probe shares the serial contract, so it still correctly refuses
  to overlap a run or a reset, but there is nothing to cancel it *with* —
  same reasoning `resetPythonState`'s own `ProgressLocation.Window` (not
  `Notification`) already relies on. `createRunCommandHandlers` gained a
  required `environment: RunCommandEnvironment` parameter, between `targets`
  and `log`; `registerRunCommands` also now registers the one
  `TextDocumentContentProvider` this extension has, in the same place (not
  inside `createRunCommandHandlers`) that command registration itself was
  moved to after 3d-i's own `registerCommand`-collision fix — the identical
  class of hazard would otherwise repeat for `registerTextDocumentContentProvider`,
  which also throws if a scheme is registered twice in one extension host.
- **`src/run/environmentStatusBar.ts` (new)** — a second status bar item,
  right of `pythonOnViya.activeProfile`, visible only once a Viya profile is
  selected (an item that always resolves to "no profile" teaches people to
  ignore it, the same reasoning ADR-0011 gives for contributing nothing to
  the editor when the target is Local). No dedicated test, matching
  `statusBar.ts`'s own precedent — a thin, mostly-`vscode`-API constructor
  function this codebase has never written one for.
- **A real, compile-breaking consequence of widening `ExecutionBackend`,
  caught by `npx tsc --noEmit` before it reached anyone else:** both
  `test/helpers/fake-backend.ts` and `test/helpers/recorded-proc-python.ts`
  implement the interface and needed a `probeRuntime()` added — the fake
  backend's is fully driveable (`FakeBackendOptions.runtimeProbeResult`); the
  recorded-transport double's delegates straight to the real
  `ProcPythonBackend.probeRuntime()` but is **not** exercised by
  `backend-contract-suite.ts`, because that double's simulated
  `getDirectoryMembers` always answers empty and nothing in the suite can
  finish a probe's own job the way it drives an `execute()` run's — recorded
  as a documented gap in that suite rather than silently left unnoted, and
  covered directly instead by `proc-python-backend.test.ts`'s own
  `probeRuntime` cases, which use the same purpose-built `router()` fixture
  that already answers `getFiles`/`getDirectoryMembers`/`getFile`/
  `getFileProperties`/`deleteFile` for 3c-i's own rich-output tests.
- **Test plan actually written:** `test/unit/backend-environment.test.ts`
  (the probe's statements and parser, accept/reject), `proc-python-backend.test.ts`'s
  new `probeRuntime` describe block (success updates `capabilities()` and
  deletes its own file; `busy`/`not-connected`; `runtime-unavailable` on a
  failing `SYSCC`, with and without `SYSERRORTEXT`; `backend-failed` for a
  missing or malformed answer file; stopped by `close()`),
  `test/unit/environment-store.test.ts` (persists, isolates profiles, drops a
  forgotten profile's key entirely, survives a fresh instance over the same
  memento — `EnvironmentStore` imports `vscode` as a **type only**, so it is
  unit-testable behind a `Map`-backed memento, the same call
  `compute-binding-store.test.ts` makes; moved here from the integration tier
  by the follow-up review below), `test/integration/run/environment-panel.test.ts`
  (the provider's not-probed-yet fallback, rendering a real cached answer,
  looking up by id rather than by name, and `refresh()`'s `onDidChange`),
  and three cases in `test/integration/run/commands.test.ts`
  (`showEnvironment`/`refreshEnvironment` refuse before connecting, the same
  as `runFile`/`resetPythonState` already do; and — added by the follow-up
  review below — `showEnvironment` serving a cached probe *without* reaching
  `sessions.connect()`, the branch the earlier pass fixed but left
  unguarded). `backend-environment.test.ts` also pins the probe script's
  `try`/`finally` cleanup and its "name and version must both be non-empty
  strings" filter, both added by that same review.
- **Verification run this session** (per "Claude never runs tests," this is
  the full extent of what this session could confirm itself): `npx tsc --noEmit`
  against all three configs, `npx prettier --check` (one file needed
  `--write`, reapplied clean), `check-copyright`, `check-secrets`,
  `check-coverage-scope` (after settling which new files `.c8rc.json` excludes
  — see the lint-and-scope bullet below), `check-contracts`, and
  `check-package` all clean. **Then run by Sean, 2026-08-27:** `npm run verify`
  (which added `npm run lint`) and `npm run test:integration` —
  `test:integration` passes 207/207 (including the new
  `showEnvironment serves a cached probe without connecting` case) and
  `test:unit` 1111/1111; `npm run lint` reported two errors, both now fixed
  (next bullet). Still ahead at that point: re-measuring coverage now that the
  denominator had grown by `environmentStore.ts`, `npm run build` packaging,
  Sean's own manual VS Code review pass, and the commit/PR.
- **`npm run lint` — two errors, both fixed in the same change, and one of
  them corrects a real tier misplacement.**
  1. `environmentPanel.ts`'s not-probed-yet guard was
     `stored === undefined || stored.capabilities.kind !== "available"`;
     `@typescript-eslint/prefer-optional-chain` wants
     `stored?.capabilities.kind !== "available"`, which is exactly equivalent
     (an `undefined` left-hand side makes the chain `undefined`, which is
     `!== "available"`). Applied.
  2. `environmentStore.ts` imported `vscode` as `import * as vscode` but used
     it only for `Pick<vscode.ExtensionContext, "globalState">` — a type.
     `@typescript-eslint/consistent-type-imports` flagged it, and it was
     right to: unlike `profile/store.ts` and `targetStore.ts` (which really
     do `new vscode.EventEmitter()` / `vscode.workspace.…` at run time and so
     belong in the excluded, integration-tested tier), `EnvironmentStore` is a
     plain `Map`-over-`Memento` class that needs no host. Changed to
     `import type * as vscode`, **removed from `.c8rc.json`'s exclude list**
     (it is now in the unit-tier denominator, where `check-coverage-scope`'s
     own doctrine says a unit-reachable module belongs), and its test moved
     `test/integration/run/environment-store.test.ts` →
     `test/unit/environment-store.test.ts` behind a local `Map`-backed
     memento, the same shape `compute-binding-store.test.ts` uses. So
     `.c8rc.json` now excludes only the two genuinely host-only new modules,
     `environmentPanel.ts` and `environmentStatusBar.ts`.
- **Re-measuring coverage after that tier move found a real branches gap, fixed
  by adding tests rather than by touching the floor.** Sean's next `npm run
  verify` (unit tier 1119/1119) reported `ERROR: Coverage for branches
  (94.93%) does not meet global threshold (95%)` — the one metric among
  `.c8rc.json`'s unchanged 93/93/92/95 floors this slice's own growth pushed
  under, not any of the others. The report's per-file breakdown pointed at
  `src/backend/environment.ts` (90.47% branches, lines 172 and 192) —
  `environmentStore.ts` itself, newly in the denominator, was already 100%.
  Both flagged lines are guard conditions no existing case actually forced
  down every arm of: `parseEnvironmentProbeFile`'s `typeof parsed !== "object"
  || parsed === null` (the existing "rejects a JSON value that is not an
  object" case passes `[1, 2, 3]`, which is `typeof "object"` in JS — arrays
  are — so it exercises neither arm; it happens to still return `undefined`,
  but by falling through to the `version`/`executable` check further down),
  and `readPackages`'s `if (!Array.isArray(value))`, which no case had ever
  made false (every fixture's own `packages` field was always a real array).
  Fixed by widening `test/unit/backend-environment.test.ts`, never by moving
  the ratchet: one case with a JSON top-level string, one with a JSON `null`,
  and one with a `packages` field that is a string rather than an array — the
  three inputs that actually walk each missing arm. Not run by this session
  (`npm run coverage`/`verify` are on the never-run list); `npx tsc --noEmit`
  and `npx prettier --check` on the changed test file are clean. **Confirmed,
  2026-08-27:** Sean's next `npm run verify` (1122 passing) measured branches
  at 95.03% — clear of the floor again — with lines/statements/functions
  unchanged at 93.87/93.87/93.48. `npm run build` then came back green.
- **Scoped adversarial-review subagent pass over the finished diff, 2026-08-27
  — one Major finding, fixed in the same diff.** `showEnvironmentImpl`'s
  cache-hit branch (`forceProbe: false`) called `backendFor()` — which calls
  `sessions.connect()`, a real network round trip and possibly an interactive
  auth prompt for a profile this window has no live session for yet — *before*
  ever checking whether a cached answer already existed. That directly
  contradicted the function's own doc comment, which promises the cache-hit
  path costs "no network call at all," and defeated a real point of having the
  cache: helping a fresh or disconnected window open a previously-probed
  profile's environment for free. Fixed by checking `profiles.get(readiness.profileName)`
  (synchronous, no I/O) and `environment.get(profile.id)` first, and only
  falling through to `backendFor()` when there is no cached answer to serve —
  `commands.ts`'s `showEnvironmentImpl` and its inline comment record the fix
  and why it was needed. The same pass checked, and found no defect in: the
  `probeController`/`isCurrentRunAborted()` cancellation race, the `def`/`del`
  probe script's Python correctness and flush-before-close ordering, the new
  `pythonOnViyaEnvironment:` URI scheme's injection safety, `EnvironmentStore`/
  `RuntimeCapabilities` typing consistency, the test doubles' faithfulness to
  the widened interface, and the `TextDocumentContentProvider`
  construct-vs-register split. Re-verified clean afterward: `npx tsc --noEmit`
  (all three configs) and `npx prettier --check`.
- **Independent senior-review pass over the finished diff, 2026-08-27 — four
  fixes, all applied in the same change.** A second reviewer, working the
  priority list (correctness/error handling, security, dialect confinement,
  strict TS, VS Code integration, tests, licensing) rather than repeating the
  adversarial pass, confirmed the design and the security posture (fixed
  extension-authored probe within ADR-0014's carve-out; no secrets in code,
  fixtures or logs; virtual document keeps the CSP surface at zero; no version
  branching outside the dialect layer) and raised four defects:
  1. *(medium)* `environment.ts`'s probe read `distribution.version` outside
     the `try` that guarded `distribution.metadata['Name']`, and kept an entry
     on `if name:` alone. One distribution with malformed `METADATA` — no
     `Version:` — is realistic across hundreds of packages, and would either
     crash `sorted(set(...))` on an unorderable `None` (surfaced as
     `runtime-unavailable`, i.e. "Python does not work" when it does) or land a
     `null` that `parseEnvironmentProbeFile` rejects whole (surfaced as
     `backend-failed`). Fixed: both reads are inside one `try`, and an entry is
     kept only when name and version are both non-empty strings — the
     unnameable few are dropped, since they have nothing this view can show.
  2. *(medium)* the adversarial pass's own cache-before-connect fix had no
     regression test. Added one (see the test-plan bullet above).
  3. *(low)* a failed probe's only deployment-specific sentence — the
     `SYSERRORTEXT` behind `runtime-unavailable` — was never written anywhere,
     while `localiseBackendProblem`'s message tells the user to "See the
     Python on Viya log for details." `showEnvironmentImpl` now `log.warn`s
     `probed.reason` before reporting.
  4. *(low)* `del __pyvia_probe_environment` ran only on the success path, so a
     probe that raised left the function name bound in the user's namespace,
     against this module's own "leaves nothing behind" claim. The call is now
     `try`/`finally`, `del` in the `finally`. `sys.version` is also newline-
     flattened so a two-line build string cannot break the plain-text layout.
- **Docs CI caught a real miss: `commands.md` was never regenerated.** Adding
  `pythonOnViya.showEnvironment`/`refreshEnvironment` to `package.json` without
  re-running `npm run docs:reference` left `docs/reference/commands.md` out of
  sync with its own generator, and `docs:reference:check` failed the build on
  it. Fixed by running the generator and committing just its two new rows
  (`[skip-review]`, matching this project's convention for mechanical docs
  regen) — `npm run check:docs` confirmed clean afterward.
- **The automated PR reviewer raised two non-blocking points on the probe
  change; both addressed in the same change.**
  1. `probeRuntime`'s fetch of its own probe file passed no explicit size cap,
     unlike `captureRichOutput`'s `maxBytes: MAX_CAPTURE_BYTES`. The transport
     already hard-caps every response body at 1 MiB
     (`auth/transport.ts`'s `MAX_BODY_BYTES`) when nothing is passed, so this
     was never actually unbounded — and the reviewer's own suggestion,
     `MAX_CAPTURE_BYTES` (10 MiB, sized for rich output), would have *loosened*
     the cap rather than tightened it. Fixed with a dedicated
     `MAX_ENVIRONMENT_PROBE_BYTES` constant in `environment.ts` (also 1 MiB,
     matching the effective behaviour today) passed explicitly at the call
     site — pinning the intended bound rather than inheriting whatever the
     transport default happens to be later, with no behaviour change now.
  2. `RuntimeCapabilities` has no cached "unavailable" member, so
     `probeRuntime()` only ever writes `this.runtime` on success — a backend
     probed successfully once and later re-probed into a failure keeps
     reporting the stale `"available"` snapshot from `capabilities()`; the
     failure reaches only the immediate caller. Currently inert (nothing in
     `src/` reads `capabilities().runtime` yet), but worth pinning down before
     a Phase 4/10 consumer trusts a stale success. Fixed with a doc-only
     callout — `backend.ts`'s `probeRuntime` interface doc and
     `procPython.ts`'s private `runtime` field doc both now say a consumer
     must treat the call's own return value as the source of truth on a
     refresh, not `capabilities()`. No logic change, so no new test; the
     existing `probeRuntime` success/failure cases already exercise the paths
     this callout describes.
  Verified before pushing: `npx tsc --noEmit` (all three configs),
  `npx prettier --check`, `npm run lint`, `npm run test:unit` (1122 passing),
  `npm run check:docs` — all clean.
- **One stale doc comment this pass found and fixed:** `compute/files.ts`'s
  `ReadFileContentOptions.maxBytes` said "`richOutput.ts` is the only caller
  with a reason to raise it" — no longer true in the letter, since
  `procPython.ts`'s `probeRuntime` is now a second caller of the option,
  though it doesn't *raise* the cap (it passes the same 1 MiB the transport
  already defaults to). Reworded to distinguish "the only caller that raises
  it" from "a second caller that only pins it."
- **The stray comment-only `test/unit/environment-store.test.ts`** left by the
  first 3e draft is gone — and the path is now the real home of the store's
  test suite (see the lint-and-scope bullet), not a placeholder.
- **Live-verified end to end against `verde`, 2026-08-27, during Phase 3's
  between-phase housekeeping — see Finding 71.** Everything up to this point
  had only ever exercised `probeRuntime()` against `test/unit/proc-python-backend.test.ts`'s
  `router()` fixture. The real success path (job, `SYSCC`, directory listing,
  content fetch, delete, cleanup) now has a live confirmation, including an
  exact match on finding 62's own package count and byte size for this
  deployment (259 packages, 6833 bytes). The `runtime-unavailable` path and
  Viya 3.5 both remain unprobed — `verde` has a working `PROC PYTHON`, so
  there was nothing to fail against.
- **What is still open, deliberately not closed by this slice:** Phase 4's
  traceback work special-casing `ModuleNotFoundError` against this list, and
  Phase 10 feeding the package set back to Pylance, both per this phase's own
  plan text; `EnvironmentStore.forget()` wired to profile deletion (noted
  above); no keybinding (none of this phase's commands ship one).

**Two "After 3d-i" follow-ups (probe cancellation; a fake-transport regression
test for `commands.ts`'s post-`connect()` paths) moved to `docs/phases/phase-4.md`'s
Runbook during Phase 3's between-phase housekeeping, 2026-08-27** — both had a
stated reason to stay open (see that housekeeping's own record in `STATUS.md`),
and both are naturally Phase 4's to pick up rather than lingering as Phase 3
debt. See phase-4.md for the full carried-over text.

☐ **3f — close the regressions the first full manual test pass found, before
Phase 4 starts.** `docs/dev/manual-test-pass.md` was run by hand end to end
for the first time since Phase 3 closed, 2026-08-27, against live `verde` and
`Innov` profiles with the packaged `.vsix`. Findings triaged 2026-08-28
(three parallel read-only investigations into the actual source, not
guesswork) — the annotated checklist itself lives in
`manual-test-pass.md`; this is the fix list. Three are confirmed P0
regressions against invariants this phase already claimed as done; the rest
are either latent bugs worth closing while in the neighborhood, or repro
gaps needing one more hand-run before being written off.

> **Implemented 2026-08-28, on `phase-3f-manual-test-regressions`; first
> independent review pass complete, not yet merged, no PR opened.** Touches
> `src/compute/sessionManager.ts`, `src/compute/commands.ts`,
> `src/auth/commands.ts`, `src/run/commands.ts`, `src/extension.ts`,
> `src/backend/procPython.ts`, `src/backend/logFilter.ts`,
> `docs/adr/0019-…md`, plus tests in
> `test/integration/compute/session-manager.test.ts`,
> `test/integration/run/commands.test.ts`,
> `test/unit/proc-python-backend.test.ts`,
> `test/unit/backend-log-filter.test.ts`, and (from the review pass)
> `test/integration/auth/commands.test.ts`. Per this project's own review
> policy, the adversarial pass over the finished diff is Sean's to run in
> his own VS Code window, not this session's — that pass happened
> 2026-08-28 and raised three findings, two fixed in commit `3d965d0` (the
> sign-out ordering/quiet-mode/Accounts-menu fixes below) plus `34a2987`
> (a pre-existing bug in this slice's own `forget()` test, surfaced only
> once the integration harness could actually launch), and one — no
> integration test drives a real `backend-gone` through `runNow`/
> `resetPythonState` into `forgetProfile` — left open and documented at
> `test/integration/run/commands.test.ts:64-66` rather than closed. What's
> still open, in order: a second, final adversarial pass over the
> post-review diff, the two hand-run retests, and the full re-run of
> `manual-test-pass.md` — none of which this session can do itself (no live
> Viya deployment reachable here, and this project's own rule against
> Claude running the suite). No PR until all of that is done, to avoid
> re-triggering CI and both reviewers more than once.

- ☑ **Fix: the `connected` context key never clears itself outside an
  explicit Disconnect.** Three symptoms (Sign Out then Run File, an idle
  session reap, and "no clear way to reconnect" generally) all traced to one
  mechanism: `pythonOnViya.connected` (`package.json:113,119`) is computed
  from `ComputeSessionManager`'s in-memory `live` map
  (`src/compute/sessionManager.ts`), synced only at activation,
  `profiles.onDidChange`, and the explicit Connect/Disconnect handlers
  (`src/compute/commands.ts:75-99,110-118`). Sign-out
  (`src/auth/commands.ts`) revoked the token but never touched `live` or
  re-synced the key. A reap was never proactively detected either —
  `connect()`'s fast path short-circuited on a cached `live` entry with no
  revalidation — so `live`/`connected` stayed stuck `true` until Disconnect
  unconditionally cleared the entry. **Landed:**
  `ComputeSessionManager.forget(profileId)` (new) drops a stale cached
  connection on request; `registerComputeCommands` now returns
  `{ connect, disconnect, forgetProfile }` instead of just `connect`, each
  wrapper re-syncing `pythonOnViya.connected` after acting; `signOut` (in
  `src/auth/commands.ts`) now calls the new `disconnect` after
  `removeSession` succeeds, mirroring how `signIn` already calls `connect`;
  `run/commands.ts`'s failure paths call the new `forgetProfile` whenever a
  `BackendProblem` comes back `backend-gone` (see the next bullet — this is
  what makes that classification actually reach the session manager).
  Covers the **Cold-start Connect**, **Reload reconnects**, and **Idle
  reap** items in `manual-test-pass.md` §4, plus **Sign out** in §3 and §10.
  **Review pass (2026-08-28), three refinements:** (1) `signOut` now runs
  `disconnect` *before* `removeSession`, not after — reversed, the teardown
  `DELETE` ran with a credential that had just been deleted, so every
  sign-out orphaned its SAS session for the idle reaper and logged a
  spurious "did not complete" warning; (2) that `disconnect` is bound to a
  new `{ quiet: true }` mode (`ComputeSessionManager.disconnect`) that
  suppresses the "there is no session to disconnect" info message, so a
  sign-out with no session open stays one toast rather than two; (3)
  `extension.ts` now also drives `forgetProfile` from the auth provider's
  `onDidChangeSessions` `removed` event, so a sign-out through VS Code's
  **Accounts menu** — which never reaches `pythonOnViya.signOut` — clears
  the cached connection and re-syncs the key too. New tests:
  `session-manager.test.ts` (quiet disconnect stays silent / still tears a
  held session down), `auth/commands.test.ts` (a `signOut` direct-handler
  suite: disconnect-before-removeSession ordering, one toast, the
  credential-already-gone and real-failure paths).
- ☑ **Fix: three failure paths in `src/run/commands.ts` never logged the
  underlying problem before showing the generic "could not be sent…see the
  log" message.** `runNow`'s execute-failure and post-run failure, and
  `resetPythonState`'s failure path, none called `log.*` before reporting —
  unlike `showEnvironmentImpl`'s probe-failure path, which already did.
  **Landed:** all three now call `log.warn(<result>.reason)` first, the same
  composed sentence `showEnvironmentImpl` already logged, and all four
  (including `showEnvironmentImpl`'s pre-existing one) now also call the new
  `forgetIfGone` helper. **A second, deeper defect surfaced while fixing
  this:** `procPython.ts`'s `translate()` picked `transfer-failed`
  unconditionally for the two upload calls, even when the underlying
  failure was already `session-gone`/`compute-unreachable` — so a dead
  session's *first* request of a run produced the least informative
  message this union has, instead of `backend-gone`'s "The SAS Viya session
  ended. Connect again and re-run." Fixed by checking `recoverable` before
  `transferStage`, matching what already happened for every failure past
  the upload stage; a new test
  (`test/unit/proc-python-backend.test.ts`, "reports a session gone during
  the upload as backend-gone, not transfer-failed") pins it — the existing
  transfer-failed tests were checked and are unaffected (none of them
  actually simulate a 404; the test helper's `status` parameter defaults to
  500 regardless of what descriptive text is passed). Covers **Failures are
  diagnosable** in §10 and the log-emptiness half of every §3/§4 finding
  above.
- ☑ **Fix: `isNoiseLine` didn't exclude `title`-typed log lines, and
  `PAGESIZE=MAX` wasn't sent at session creation.** Both gaps were already
  written down in `logFilter.ts`'s own doc comment from the 2026-08-25
  probe — finding 63 confirmed the page-break banner arrives typed `title`,
  which `isNoiseLine` didn't exclude — but neither was picked up as a fix
  before 3b was marked done. Matched this pass exactly: a stray banner line
  in 4 of the 14 submission-corpus runs, and one roughly every 58 lines in
  the 5000-line **Large output stays clean** test (§6). **Landed:** `title`
  added to `isNoiseLine` (`logFilter.ts`), plus a new `SESSION_OPTIONS =
  ["PAGESIZE=MAX"]` passed to `createSession` in `sessionManager.ts`'s
  `open()`; a new case in `test/unit/backend-log-filter.test.ts` pins the
  `title` exclusion.
- ☑ **Fix (latent, not yet reproduced by a QA symptom, found while
  investigating the profile-switch report below):** `ComputeSessionManager
  .connect()`'s single `this.connecting` field was not keyed by profile — a
  second, unrelated `connect()` call arriving while a first was still in
  flight for a *different* profile would join that first promise and
  receive the wrong profile's connection back, mislabeled. Doesn't by
  itself explain the report below, but was real and sat in the same code.
  **Landed:** `connecting` is now a `Map<string, Promise<…>>` keyed on
  profile id; `disconnect()`'s own wait-for-a-connect-in-flight logic
  updated to match, re-reading the active profile after the wait per this
  file's own "re-read after a round trip" rule. A new
  `test/integration/compute/session-manager.test.ts` case ("forget() drops
  the cached connection…") pins `forget()`'s own behaviour; a dedicated
  regression test proving two *different* profiles' connects never join
  each other is **not yet written** — it needs a harness able to run two
  independent connect flows concurrently and was judged too easy to get
  subtly wrong without being able to run it this session, so it is called
  out here rather than guessed at.
- ☐ **Retest, narrated click by click: "ran a long program on profile A,
  switched to profile B and signed in, B ran the same program
  unprompted."** No queue/replay/resume code path exists anywhere in
  `src/run` or `src/compute` — a program is captured synchronously at
  invocation (`buildProgram`, before any `await`), and backends are cached
  per profile. Most likely explanation is Run was in fact invoked again;
  needs one clean repro before being closed either way. Unchanged by this
  slice's fixes — still open.
- ☐ **Retest: the deep-recursion script that crashed the Python subprocess**
  ("terminated unexpectedly… trying to use more memory than the container
  is configured to allow") **immediately after its own 5 unit tests had
  already passed.** Not implicated in 3c-ii's frame-trimming logic itself —
  plausibly a container memory/stack ceiling question — but needs one more
  run to see if it reproduces before writing it off. Covers **Deep /
  recursive stacks survive** in §7. Unchanged by this slice's fixes — still
  open.
- ☑ **Doc: state ADR-0019's cancelled-run-orphans-a-partial-figure-file
  behavior explicitly.** Already correct by design, just implicit: a
  cancelled run skips `captureRichOutput` entirely, so a figure file
  written before cancellation is neither read back nor deleted. **Landed:**
  a new dated amendment section in ADR-0019 states this as a confirmed,
  deliberate trade-off rather than something a future reader has to
  re-derive from `procPython.ts`.
- ☑ **Reword pass, already applied to `manual-test-pass.md` itself
  (2026-08-28), confirmed correct against the code rather than left as
  found:** the **Cancel scoped to the active profile** regression check
  (§11) used a two-*window* repro that cannot exercise what it claims —
  each window is its own extension host with no shared `currentRun`/
  `currentReset` state — reworded to a same-window profile switch, which
  `cancelRun`'s tracking (`commands.ts:189,201,481,501`, the PR #63 fix)
  already handles correctly. `defaultProfile` (§2a) is real
  (`package.json:222-227`) and settings-only by design — reworded to say so.
  Neither needed a code change.
- ☐ **Full re-run of `manual-test-pass.md`** once the fixes above are
  reviewed and merged, to confirm them and pick up anything this first pass
  missed.

> This is the first genuinely useful build. Install the `.vsix` locally and use
> it for real work for a few days before starting Phase 4. Real use will
> reorder your priorities more reliably than the plan will.

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


---

## Probe findings

## 2026-08-20 — `TIMEOUT` and `SRC`, settling ADR-0014's two open questions before 3a (Viya 4)

Finding 34 enumerated `PROC PYTHON`'s option set from its own error message —
`COMMAND, ECHO, INFILE, RESTART, SRC, TERMINATE, TIMEOUT` — and flagged `TIMEOUT`
as relevant to 3a-ii's Cancel design and `SRC` as a possibly-second hand-over path
alongside `INFILE=`, both left unprobed at the time. This is that probe.

**Documented shape, established first.** SAS's own "What's New in Programming on
the SAS Viya Platform" page (a real, extractable PDF — the interactive HTML help
center is a client-rendered Angular app and could not be scraped at all) states:
"The TIMEOUT= option has been added to the PROC PYTHON statement. This option
lets you specify the number of seconds to attempt to connect to the Python
environment before ending." A separate syntax listing showed `TIMEOUT=n` inside
angle brackets on the syntax diagram, appearing to place it on both the `PROC`
statement and the `SUBMIT` statement. That second placement turned out to be a
documentation-scraping artifact (see Finding 58's negative result below), not a
real option.

### Finding 58 — `TIMEOUT=` is a connect-time bound on `PROC PYTHON` itself, and does not exist on `SUBMIT`

`submit timeout=2;` and `submit timeout=10;` both failed to parse, identically:

```
ERROR 22-322: Syntax error, expecting one of the following: a quoted string, ;.
ERROR 202-322: The option or parameter is not recognized and will be ignored.
ERROR 180-322: Statement is not valid or it is used out of proper order.
```

So `SUBMIT` takes no `TIMEOUT=` suboption on this deployment — the syntax
diagram's apparent second placement does not hold up against the parser.

`proc python timeout=2;` **is** valid, and does not bound the submit block's
running time. A block that opened with `timeout=2` and then ran
`time.sleep(5)` inside `submit`/`endsubmit` completed normally, printing its
output, at a measured real time of 6.88 seconds — nearly 3.5× the `timeout`
value, with no error, no early termination, and no `error` job state. A second
run with `timeout=30` and `time.sleep(1)` completed in 1.00 second, the
unremarkable case. The two runs together confirm the documented text literally:
`TIMEOUT=` bounds only the connection handshake to the Python environment,
never the wall-clock time of code already running inside it.

**Consequence for 3a-ii's Cancel design:** there is no `TIMEOUT=`-based
execution limit to build on. A hung or long-running Python step can only be
stopped the way `job.ts` already does it — by following the job's `cancel`
relation — and `cancelJob`'s own doc comment is correct that whether the
running step actually stops promptly on that request is a separate, still-open
question this probe does not touch. `TIMEOUT=` was never a candidate answer to
it; it answers a different question (slow or hung interpreter *startup*) that
this project has not needed to solve.

### Finding 59 — `SRC=` parses, but is the same file-open code path as `INFILE=`, not an inline alternative

`SRC` really is in the option grammar, exactly as finding 34's error message
said. But it is not a second way to hand over code — it opens a *file*, the
same as `INFILE=`, and gives the same error when it can't:

- `proc python src="print(1+1)";` — parses. Runs. Fails with
  `ERROR: Failed to open the file on the INFILE= statement` — note the message
  names `INFILE=` even though the statement used `SRC=`. SAS attempted to open
  a file literally named `print(1+1)`, not to execute the quoted text as
  Python source.
- `proc python src=nosuchfr;` (an unassigned fileref) — same failure, same
  `INFILE=`-naming error message, confirming the fileref-resolution path is
  shared with `INFILE=` rather than merely producing a similar-looking error.

**Reading:** `SRC=` is an alias (or a legacy/internal name) for the same
file-based mechanism `INFILE=` already uses, not an inline-source option. There
is no evidence here of any way to hand `PROC PYTHON` code other than by naming
a file or fileref — which is exactly ADR-0014's `INFILE=` mechanism. This
settles the ADR's open question: `SRC=` was never a real second path to design
around, and no code or design change follows from this finding.

### What this probe did not settle

- **Whether a hung Python step actually stops on `cancel`.** Unchanged from
  `job.ts`'s existing note — this probe tested `TIMEOUT=`, not `cancel`, and
  the two are now known to be unrelated mechanisms.
- **`ECHO` and `COMMAND`**, the other two options finding 34 enumerated and
  never probed. Still open; neither was in this probe's scope (3a-i was
  `TIMEOUT` and `SRC` only, per the punch list).
- **Whether `SRC=` differs from `INFILE=` in any way** (e.g., a different
  default search path, or acceptance of a bare unquoted string `INFILE=`
  rejects). Only the failure path was probed, because there was no successful
  case to compare — a quoted string and an unassigned fileref were both tried
  and both failed identically to `INFILE=`'s failure mode. A deployment or
  release where `SRC=` succeeds has not been observed.
- **Viya 3.5.** Not probed, as ever.

## 2026-08-21 — The `variables` collection, before writing `variables.ts` (Viya 4)

Finding 37 established that `SYSCC` is readable live via
`GET /compute/sessions/{id}/variables/SYSCC`, but never recorded whether that
path is followed from a link the deployment sends or composed by hand — a
real gap, since ADR-0010 forbids composing anything the deployment did not
hand back as an href. Probed against `verde` before writing the module 3a
needs to read `SYSCC` for real, because guessing the shape and correcting it
later is exactly the kind of wire mistake this project's probe-first
discipline exists to catch.

### Finding 60 — A collection item carries its own `self` link, and a filtered read returns the value inline

The session's `variables` relation (finding 21 already listed it as one of
the nine collection relations, never followed) is `GET`, `Accept:
application/vnd.sas.collection+json`, and on a fresh session reports `count:
82`. Each item carries exactly one link:

```json
{
  "name": "SYS_COMPUTE_JOB_ID",
  "links": [
    {
      "href": ".../variables/SYS_COMPUTE_JOB_ID",
      "method": "GET",
      "rel": "self",
      "type": "application/vnd.sas.compute.session.variable",
      "uri": ".../variables/SYS_COMPUTE_JOB_ID"
    }
  ]
}
```

So the composed-looking path in finding 37 is not a guess after all — it is
exactly what the collection's own `self` link says, one per variable, which
is what makes following it (rather than composing `{href}/{name}` by hand)
the ADR-0010-compliant read.

**A name filter is better than either.** `GET .../variables?filter=eq(name,'SYSCC')`
returns `{"count":1,"items":[{"name":"SYSCC","value":"0","links":[...]}]}` —
the `value` is already inline on the filtered collection item, so reading one
named variable is **one request**, not two: filter the collection, read
`items[0].value`. There is no need to also follow the item's own `self` link
unless a caller wants the single-variable representation for its own sake.

**The single-variable media type has no `+json` suffix, unlike everything
else in this codebase.** `GET` on an item's own `self` link with
`Accept: application/vnd.sas.compute.variable+json` (the natural guess,
matching every other Viya media type this project has seen) answered `406`:

```json
{
  "httpStatusCode": 406,
  "message": "An invalid or unexpected Accept header type of application/vnd.sas.compute.variable+json was provided...",
  "remediation": "Valid Accept header values are: application/json, application/vnd.sas.compute.session.variable, text/plain."
}
```

The real type is `application/vnd.sas.compute.session.variable` — `session.`
inserted, and no `+json` — confirmed by the collection item's own `type` key
above, which already carried it. This does not matter for `variables.ts`
itself, since the filtered-collection read never needs this media type at
all; it matters for anyone tempted to follow a variable's `self` link by hand
with a guessed `Accept` header.

**Reading:** `variables.ts` should follow the session's `variables` link,
append `?filter=eq(name,'<var>')` the same way `contexts.ts` already filters
by name (findings 15/22 — the apostrophe is the only character to escape),
and read `value` off the one item the filter returns. No composed single-item
href, no new media type constant beyond the ordinary collection one already
in use everywhere else.

### What this probe did not settle

- **Whether an unrecognised variable name answers an empty collection or an
  error.** Only `SYSCC`, which exists on every session, was tried. A caller
  reading `SYSERR`/`SYSERRORTEXT` (finding 37 also names these) should not
  need this, since all three are guaranteed session variables, but a name
  that does not exist at all was not tested.
- **Whether `value` is ever absent from a filtered item** rather than an
  empty string. Not observed either way; `variables.ts` should decide how to
  read a missing `value` defensively rather than assume the one case tried is
  the only shape.
- **Viya 3.5.** Not probed, as ever.

## 2026-08-25 — Rich output: the file mechanism, the log-wrap trap, and one poisoned-session repro (Viya 4)

3c's own punch list named two candidates for returning a matplotlib figure or a
DataFrame's HTML repr: write to the session filesystem and fetch via the
Compute files API, or base64 through the log. Probed against `verde` before
sizing the implementation slice, because — per the user's own framing —
whether this is possible at all with what `PROC PYTHON` provides was
genuinely open going in.

### Finding 61 — Writing to the session's cwd and fetching via the Compute files API is a clean, byte-perfect mechanism for both a PNG and an HTML file

`fig.savefig("probe_plot.png")` inside a `submit`/`endsubmit` block wrote a
23,206-byte file to the session's private working directory
(`os.getcwd()` resolved to
`/opt/sas/viya/config/var/run/compsrv/default/<session-guid>`). The session's
own link set (`GET` on the session, `Accept:
application/vnd.sas.compute.session+json`) carries a `getFiles` relation at
`.../files`; following it returns the *cwd's own directory properties*, not a
listing, with a `getDirectoryMembers` link. Following *that* returns a
collection whose items are the files actually in the directory, and each item
carries its own `getFile` link, method `GET`, at `.../<encoded-path>/content`.

Fetching that link returned exactly 23,206 bytes, a valid PNG signature
(`89 50 4E 47 0D 0A 1A 0A`), and decoded correctly as a 640×480 RGBA image —
byte-for-byte the file `os.path.getsize` reported server-side. The same
mechanism, unmodified, worked for `pandas.DataFrame.to_html()` written to a
`.html` file: 393 bytes out, 393 bytes back, valid markup.

**The server reports the correct MIME type unprompted.** The PNG's `getFile`
link carried `"type": "image/png"`; the HTML file's carried `"type":
"text/html"` — inferred from the file extension the Python code itself chose,
not from any option this project set. A response fetched with no `Accept`
header at all still answered with the matching `Content-Type` header.

**Reading:** this is the mechanism. `RichOutput`'s `image/png` and `text/html`
arms can both be filled by: have the emitted Python write to a
predictable-but-collision-safe filename in its own cwd, follow the session's
`getFiles` → `getDirectoryMembers` → item's `getFile` link chain (never
compose the encoded path by hand — ADR-0010), and read the response body
directly as bytes (base64-encoding only if `RichOutput.image/png`'s own
contract requires it at the seam, which `backend.ts` already documents it
does). No parsing of anything through the log is needed for either mime type.

### Finding 62 — Base64 (or any text) through the log wraps at a hard character count, mid-token, with no boundary marker — ruling it out as a naive channel

A `print("A" * 300)` — one logical call, no whitespace anywhere in the
argument — arrived as **three** `normal`-typed log lines of length 132, 132,
and 36. Since the source string had no word boundaries at all, this is not a
word-aware wrap: it is a hard cut at a fixed column count, consistent with
`LINESIZE`'s documented default of 132. A second string built from five
50-character blocks joined by single spaces (254 characters total) wrapped as
102, 102, 50 — still governed by the same column limit, not by a
word-boundary rule; the apparent "space-aligned" breaks in that case were
coincidental, not evidence of smarter wrapping.

`options linesize=max;` before the `PROC PYTHON` block **raises the cap to
256, it does not remove it**: the same 300-character no-whitespace string
then wrapped as 256 + 44, two lines instead of three. There is no session
option this probe found that disables the wrap outright.

**Consequence:** any payload a naive implementation prints and expects back
as one unbroken string — a base64-encoded image, in particular, which by
construction contains no natural break points — will be silently corrupted
past 132 (or 256, at best) characters, with **no marker distinguishing "this
line is a wrapped continuation" from "this line just happens to be exactly
132 characters long."** That ambiguity is not fixable by a consumer guessing
at reassembly; it would require the *emitting* Python to chunk its own output
below the wrap width with an explicit sequence marker per chunk (e.g.
`print(f"B64|{i:06d}|{chunk}")`), turning a one-line print into a
hand-rolled, per-payload reassembly protocol. Finding 61 makes this
unnecessary: the file mechanism has no line-based transport step for a rich
payload to pass through at all.

**This does not touch 3b's already-shipped filter design.** `logFilter.ts`
maps one `LogLine` to one `text/plain` output regardless of whether that
line's text is a complete logical `print()` call or a wrapped fragment of a
longer one — the filter was never responsible for reassembling wrapped
`print()` output, only for deciding which typed lines are shown at all. The
practical effect is cosmetic, not a defect: a single very long `print()` call
will render as several consecutive `text/plain` outputs in whatever surface
renders them (3d-i's output channel), with no indicator that they were
originally one call. Worth naming as a known limitation if 3d-i's output
channel design wants to address it; not something this probe's findings
require fixing.

### Finding 63 — A page-break banner is real, and it is typed `title`, not `note`

`logFilter.ts`'s own doc comment guessed, before any deployment had been
asked to produce one, that a page-break banner would arrive "most plausibly"
typed `note`. The matplotlib job in finding 61 triggered one for real (a
`PROC PYTHON` step long enough to force a page break), and it arrived as its
own log item:

```json
{"type":"title","line":"3                                                          The SAS System                       Tuesday, August 25, 2026 11:05:00 AM"}
{"type":"title","line":""}
```

— `title`, a fifth type alongside `source`, `note`, `normal`, `error`, not
previously named in this project's vocabulary. `isNoiseLine` excludes only
`note` and `source`, so a banner passes through **unfiltered, as visible
output**, today. `logFilter.ts`'s doc comment and `CHANGELOG.md`'s 3b entry
are both corrected in this same pass to stop citing the wrong guess; whether
`title` should join the excluded set is left open for whichever slice next
touches this filter, per this file's own review-findings policy of batching
related edits rather than half-fixing one in passing.

### Finding 64 — Inline `SUBMIT`-block content that is not valid for its context poisons the session's parser state for every later submission, until `PROC PYTHON RESTART`

While probing, a job was submitted with bare Python (`import pandas as
pd...`) accidentally missing its `proc python; submit; ... endsubmit; run;`
wrapper. It failed, as expected, with `ERROR 180-322: Statement is not valid
or it is used out of proper order.` at the first bare line. The **next** job
submitted on the same session — this time correctly wrapped, `proc python;
submit; ...` — failed with the *identical* `180-322` error, on the `proc
python;` statement itself, which is otherwise unimpeachable syntax. The
session's SAS-side parser state, not just its Python state, had been left
inconsistent by the first failure. `proc python restart;` (a job of its own,
`run;` and nothing else) recovered it cleanly — `NOTE: Previous Python state
destroyed.` / `NOTE: Python initialized.` — and the same, now-correctly-wrapped
job succeeded immediately afterward.

**Reading:** this is a live, wire-confirmed instance of exactly the failure
mode ADR-0014 already reasoned about in the abstract when it rejected inline
`SUBMIT` of untrusted code in favour of `INFILE=` — "inlining code in a
`SUBMIT` block can silently poison the session for every later submission." It
does not change ADR-0014's decision (this project was never going to inline
`SUBMIT` content, and this reproduction came from a probe script's own bug,
not from anything the extension would ever construct), but it is worth
recording as corroborating evidence rather than only a theoretical concern,
and as a note for the `viya-api-probe` skill's own playbook: a probe session
that starts erroring on syntactically valid statements has likely been
poisoned by an earlier malformed submission on the same session, and
`proc python restart;` is the recovery, not a fresh session.

### What this probe did not settle

- **Whether `title` should be added to `isNoiseLine`'s excluded set.** Left as
  an open design question for the slice that next touches the filter, not
  decided here.
- **Whether a page-break banner can appear *mid-run*, splitting a single
  logical output's surrounding log lines apart**, as opposed to appearing
  between complete statements the way finding 63's reproduction did. Not
  tested; the existing atomic-log-item reasoning in `logFilter.ts`'s doc
  comment holds regardless, since each item is typed once, on its own, but
  the specific interleaving was not exercised.
- **Filenames and collision avoidance** for the write-then-fetch mechanism —
  finding 61 used a single fixed name per probe run on a session used by
  nothing else concurrently. A real implementation needs its own naming and
  cleanup convention (this probe deleted its own files by relying on session
  teardown, per finding below, not by exercising `deleteFile` successfully —
  see next point).
- **Viya 3.5.** Not probed, as ever — `creds.json` carries no 3.5 entry to
  probe against.

### Finding 65 — `deleteFile` needs `If-Match`, and the ETag is available without fetching the file's content

The `428 Precondition Required` finding 61 left unresolved is exactly what it
says: `deleteFile` (`DELETE` on a file's own link) requires an `If-Match`
header carrying the file's current ETag, quoted. A `DELETE` with no
`If-Match` at all answers `428`; the identical request with
`If-Match: "<etag>"` answers `204`, and a follow-up `GET` on the same link
then answers `404`.

**The ETag does not require fetching the file's content first.** A plain
`GET` on the file's own `getFileProperties`/`self` link (small, JSON,
no `Accept` override needed) carries the same `ETag` **HTTP header** a full
content fetch would — confirmed by deleting with an ETag read exactly this
way, immediately after writing the file, with no intervening content GET.
The ETag is **not** present anywhere in that response's JSON **body** — only
the header carries it.

**Reading:** the write-then-fetch-then-delete lifecycle a real 3c-i
implementation needs is three requests, not four: write the file from
Python, `GET` its properties to read `outputs` and grab the `ETag` header
(or fetch content directly and read the same header off that response, if
the content is being read anyway), then `DELETE` with `If-Match` once the
`RichOutput` has been captured. No polling, no retry-on-428 loop needed —
the precondition is satisfiable on the first attempt as long as the ETag
came from a GET no earlier request has since invalidated.

### Finding 66 — The write-then-fetch mechanism holds at a realistic image size, not just a trivial one

Finding 61's PNG was a default-sized, mostly-empty 640×480 plot at 23,206
bytes — small enough that a chunking or size-cap surprise could have hidden
behind it. A four-panel, 2400×1800-pixel figure with 20,000 plotted points
per panel and dpi=200 (`fig.savefig`, same mechanism, same session
filesystem) produced a 262,591-byte file, written and fetched with no
change to either step: same `getFiles` → `getDirectoryMembers` → `getFile`
link chain, same byte-for-byte match between `os.path.getsize` and the
fetched file's size on disk, same valid PNG signature, decoding correctly
as 2400×1800 RGBA. Roughly 11× finding 61's size, chosen to be closer to
what a real user's figure looks like rather than the library default.

**Reading:** nothing about the mechanism is size-sensitive in the range this
probe checked (tens of KB to a few hundred KB). No evidence either way for
multi-megabyte figures (very high DPI, very large `figsize`, or an
uncompressed format) — if 3c-i's design ever needs to bound output size, that
would be its own, separately-motivated decision, not one this probe's
evidence requires.

### What this second pass did not settle

- **Whether the ETag from a properties `GET` can go stale between reading
  it and using it in `If-Match`** — e.g., another process rewriting the same
  filename in between. Not tested; the single-writer, one-session-at-a-time
  shape of `PROC PYTHON` (serial execution, ADR-0015) makes this an edge case
  rather than a live concern for 3c-i's design.
- **Multi-megabyte files.** Not tested at any size above ~256 KB.
- **Viya 3.5.** Not probed, as ever — no 3.5 credentials available.

### Finding 67 — A `getDirectoryMembers` listing item carries `size` directly, with no content fetch needed

Raised by the Claude reviewer on ADR-0019's PR: the ADR asserted "size is
sufficient" for the before/after directory diff without citing evidence that
a bare listing entry (as opposed to a `getFileProperties` or content
response) actually carries one. The reviewer's challenge to the *citation*
was right — this had never been written up as its own finding — but its
factual claim, that no probe had shown a listing item carrying `size`, was
wrong, and re-checked live against `verde` rather than settled from memory
alone (a fresh session, a plain 12,345-byte file, a `GET` on
`getDirectoryMembers` with no properties or content request in between):

```json
{
  "isDirectory": false,
  "links": [ … ],
  "modifiedTimeStamp": "2026-08-25T19:25:36.815Z",
  "name": "size_check.txt",
  "path": "/opt/sas/…/<session-guid>",
  "readOnly": false,
  "size": 12345,
  "version": 1
}
```

`size` is present on the listing item itself, matching `os.path.getsize`
exactly, with no properties GET or content fetch in the request chain. The
item also carries `modifiedTimeStamp` and `version`, either of which could
have supplemented or replaced size as a diff key — not pursued, since size
alone already answers ADR-0019's diff step without a second request per
candidate.

**Reading:** ADR-0019's design stands as written; only its citation was
missing, now fixed by pointing at this finding instead of asserting the
claim bare. The reply to the reviewer's comment says the same thing, with
this finding as the evidence.

**Session cleanup:** the probe session was deleted and confirmed gone with
`404` after this check.

### Finding 68 — The listing-item and directory-properties link relations, printed rather than read off prose

Findings 61 and 65 described this mechanism's relations in prose —
"the file's own `getFileProperties`/`self` link", "`deleteFile` (`DELETE` on
a file's own link)" — without printing the literal `rel` strings a caller has
to search for. Executing 3c-i needed the exact names, so this is that probe,
run against `verde` on 2026-08-25: a fresh session, a context of
`SAS Job Execution compute context`, a `PROC PYTHON` job writing one small
text file (`probe_rel_check.txt`, 16 bytes, chosen over a PNG because the
relation names do not depend on the file's content), and the full `links`
array read at both levels before any relation was followed.

**The session's `getFiles` relation resolves to the working directory's own
properties representation** (`Accept: application/vnd.sas.compute.file.properties+json` —
without the `+json` suffix the deployment answers `406`, confirming
`computeMediaType`'s suffixing rule applies here too). That representation's
own `links` carry, alongside `getDirectoryMembers`, five directory-management
relations this module never follows: `self`, `getDirectoryProperties`
(identical href to `self`), `deleteDirectory`, `renameDirectory`,
`makeDirectory`, `createFile` (on the directory, for creating a *new* file —
distinct from the per-item `createFile` below), and `copyDirectory`.

**A listing item's own link set, confirmed in full:**

```json
{
  "isDirectory": false,
  "name": "probe_rel_check.txt",
  "path": "/opt/sas/viya/config/var/run/compsrv/default/<session-guid>",
  "size": 16,
  "version": 1,
  "links": [
    { "rel": "self", "method": "GET" },
    { "rel": "getFileProperties", "method": "GET" },
    { "rel": "getFile", "method": "GET" },
    { "rel": "deleteFile", "method": "DELETE" },
    { "rel": "createFile", "method": "PUT" },
    { "rel": "renameFile", "method": "PUT" },
    { "rel": "copyFile", "method": "POST" }
  ]
}
```

(hrefs and the `~fs~`-escaped path segment finding 61 already described are
elided above; every href on this item resolves to the same encoded path,
`.../content` appended for `getFile`/`createFile`.) `self` and
`getFileProperties` are **two distinct relation names at an identical href**
— confirmed byte-identical, not assumed synonyms, which settles what finding
65's own "`getFileProperties`/`self`" phrasing left ambiguous. **`deleteFile`
is its own name, not `delete`** — the bare `delete` this project's other
resources (a session, a job, a fileref's `deassign`) all use does not appear
on a file item at all, so composing it by analogy from those would have been
a wrong guess this probe exists to rule out before `files.ts` shipped with it.

**The ETag round trip, re-confirmed alongside the relation names:** `DELETE`
on `deleteFile` with no `If-Match` answered `428`; the identical request with
`If-Match` set from the `ETag` **header** of a `getFileProperties` `GET`
(absent from that response's JSON body, as finding 65 already found)
answered `204`; a following `GET` on the same item answered `404`. No new
behaviour here, only the same finding 65 measured, now against the exact
relation names rather than a paraphrase of them.

**Reading:** `files.ts` is written against these confirmed names
(`GET_FILES_REL`, `DIRECTORY_MEMBERS_REL`, `FILE_PROPERTIES_REL`,
`FILE_CONTENT_REL`, `FILE_DELETE_REL`) rather than against findings 61/65's
prose. `deleteSessionFile` follows `getFileProperties`, not `self`, for its
fresh-`ETag` read — either would work, since they are the same resource, but
`getFileProperties` is the clearer name to read in a call site and is the one
this finding actually printed.

**What this did not settle:** whether `getDirectoryProperties`/`self`'s own
apparent duplication (two names, one href) holds for every representation in
this API family, or is specific to a compute file/directory resource — not
pursued, since `files.ts` only ever needs one of the two names to work.
Viya 3.5 is unprobed here, as ever.

**Session cleanup:** the probe session was deleted and confirmed gone with
`404` after this check.

### Finding 69 — `ComputeClient`/`nodeHttpTransport` had no way to carry a binary response, discovered while writing `files.ts`'s content fetch

Implementing `readFileContent` surfaced that `auth/transport.ts`'s
`nodeHttpTransport` — the one transport every `ComputeClient` request shares
— always decoded a response body with `Buffer.toString("utf8")` and capped it
at `MAX_BODY_BYTES` (1 MiB), regardless of content type. Neither limit is a
wire finding; both are properties of code this project had already written,
for callers (a token response, a Compute JSON representation) that were
always textual and always small. Finding 61's own read of a PNG's bytes back
"directly as bytes" was true of the *deployment*, probed with `curl` outside
this codebase — it was never a claim about what `client.ts` could do, and
nothing before 3c-i had ever asked it to carry binary content.

Decoding a PNG's bytes as UTF-8 is lossy and irreversible wherever the byte
stream is not valid UTF-8 — near-certain in real PNG data, whose CRCs and
zlib-compressed chunks are arbitrary bytes — so fetching finding 61/66's own
23,206- or 262,591-byte figures through the transport as it stood would have
silently corrupted them. Separately, the 1 MiB cap sits well under ADR-0019's
own 10 MiB rich-output ceiling, a size finding 66 never had reason to probe
(its largest measured figure was 262,591 bytes).

**Fixed as part of 3c-i, confirmed with Sean before touching the shared
layer** (a cross-cutting change, `auth/transport.ts` and `src/compute/client.ts`
being shared by every Compute request in the project): `TransportResponse`
gained an optional `bytes()` accessor, reading the same buffered response
`text()` already does — no extra network cost — and `TransportRequest`/
`ComputeRequest` gained an optional `maxBodyBytes` override, defaulting to the
existing 1 MiB cap when absent. `ComputeResponse` gained `rawBody`, populated
from `bytes()` whenever the transport provides it. Every existing caller is
unaffected: `bytes`/`maxBodyBytes` are optional, no existing `TransportResponse`
literal in the test suite needed updating, and the 1 MiB default is unchanged
for everything that does not explicitly raise it. `files.ts`'s `readFileContent`
is, today, the one caller that does — passing `richOutput.ts`'s
`MAX_CAPTURE_BYTES` (10 MiB) through as the cap for a rich-output content
fetch.

**Reading:** this is not an amendment to ADR-0019's decision (the capture
mechanism itself is unchanged) but a prerequisite ADR-0019 turned out to
depend on without saying so — recorded here, and as a short amendment on
ADR-0019 itself, so the next reader of that ADR does not have to rediscover
that the byte-perfect fetch it describes needed the transport layer's own
capability widened first.

**What this did not settle:** whether a future caller wanting bytes from a
transport that predates `bytes()` (none exist in this codebase today) should
get a distinguishable failure rather than a silent `rawBody: undefined` —
`files.ts`'s `readFileContent` already treats an absent `rawBody` as
`response-malformed`, which was judged sufficient rather than adding a new
`ComputeProblem` member for a case nothing has ever produced.

### Finding 70 — `proc python infile=<fileref>;` alone never closes its step; the job reports `completed`, `SYSCC` reads its stale default, and nothing it wrote is visible, until something else closes it

The live rich-output test (`test/live/proc-python-rich-output.test.ts`) failed
its first real run against `verde` with zero outputs of any kind — not even
the ordinary `text/plain` log lines a run with no `print()` output would
still be expected to lack, which was itself the tell, since `SYSCC` still read
`0` and the job still reported `completed`. Diagnosed with a standalone script
against the project's own compiled `src/compute/*` modules (not the test
suite — read-only-ish probing per the `viya-api-probe` skill's own workflow),
against a fresh session, first job:

A `proc python infile=<fileref>;` job — exactly what `runProgram` submits
today, no `run;` — reports `state: completed` in under a second, nowhere near
the several real seconds a matplotlib import measurably takes. Its log stays
frozen at exactly two lines (the wrapping statement's own `source`-typed echo,
and one blank `note`) for over sixty seconds of continuous polling, on both
the job's log and a bare directory listing — no Python banner, no `print()`
output, no `NOTE: PROCEDURE PYTHON used`, and the file the script wrote is
absent from `getDirectoryMembers` the entire time. `SYSCC` reads `0`
throughout, which is indistinguishable from genuine success, because `0` is
also its value before anything has run.

**Submitting a second job to the same session immediately surfaces
everything the first job actually did** — its full log (Python banner, real
output, procedure NOTE) appears prefixed onto the second job's own, and the
first job's output file appears in the directory listing. Reproduced twice.
A single non-job request (a bare `SYSCC` read) does **not** have this effect
— only starting a new step does.

**Confirmed as the fix: appending `run;` as a second statement in the same
job.** `createJob(client, session, ["proc python infile=probeG;", "run;"])`
against a fresh session's first job produced `state: completed` at the
correct elapsed time (matching the real import cost), the full log
immediately, and the output file in the very first post-job listing —
no second job needed.

**Reading:** SAS does not consider a step's log, variables or file writes
final until the step closes — ordinarily at `run;`/`quit;` or, failing that,
implicitly at the *next* step's boundary. `proc python infile=<fileref>;`
alone never closes its own step, so the job resource's `completed` reflects
only that the request was accepted and the file was read, not that the step
finished — and every read this project makes afterward (`SYSCC`, the log, and
now `files.ts`'s directory listing) can race a step that has not actually
closed. This is not the poisoning finding 33 already named — no earlier
statement failed here, this is a session's very first job — but it produces
the same outward shape finding 33 does: `completed`, and nothing ran.

**Why nothing caught this until now.** Finding 61's own probe used a
`submit`/`endsubmit` block, not `infile=`, to write and verify a file — a
different submission path, not the one `runProgram` actually sends.
`test/live/viya4-job.test.ts`, the only prior live test to submit a job at
all, submits a bare `%put <marker>;`, never `PROC PYTHON`. So `infile=`'s own
completion signal, read immediately after a session's first job, had never
been exercised end to end against a real deployment before this slice's own
live test did — and ADR-0014's `SYSCC`-over-`state` mitigation, aimed at
finding 33's poisoning case, does not protect against this one, since `SYSCC`
itself is one of the things left unflushed.

**Fixed in 3c-i** (ADR-0014 amendment, below): `runProgram`'s and `reset()`'s
`createJob` calls both now send the statement as two array elements, the
second always `"run;"`. No change to `logFilter.ts` was needed — `isNoiseLine`
already excludes every `source`-typed line, which is what `run;`'s own echo
arrives as, the same as the wrapping statement's.

**What this does not settle.** Whether `quit;` is also needed alongside
`run;` for every case, or whether a step can be left open long enough that a
*third* job (not just a second) is needed to flush it, are both unprobed —
`run;` alone was sufficient in every case tried here. Viya 3.5 is unprobed for
this, same as everything else in this phase.

### Finding 71 — `probeRuntime()`'s full wire sequence, confirmed end to end against a live Viya 4 session, 2026-08-27

Phase 3's between-phase housekeeping called for a live check of 3e's probe —
everything in `test/unit/proc-python-backend.test.ts` exercises it against the
`router()` fixture, never a real deployment. Run against `verde` via a
standalone script driving the raw Compute API (not the compiled extension, and
not the test suite — the same `viya-api-probe`-style probing finding 70 used),
submitting the exact statements `environmentProbeStatements()` produces (the
`def`/`try`/`finally`/`del`-wrapped probe, plus the caller's own trailing
`run;`) against a fresh `SAS Studio compute context` session:

- **The job completed and `SYSCC` read `0`** — read correctly only after
  switching from a guessed `GET /compute/sessions/{id}/variables/SYSCC` (which
  the deployment answered `406`) to what `readVariable` actually does: follow
  the session's own `variables` collection link and filter it by name
  (finding 60). The first attempt's `406` is a defect in the probe script that
  wrote it, not in `procPython.ts` — `readVariable` was never at risk of
  making the same mistake, since ADR-0010 already forbids composing a path by
  hand.
- **The working directory held exactly one file, `__pyvia_environment_probe__.json`**
  — confirming `probeRuntime()`'s single-listing design (no before/after diff
  needed, unlike `captureRichOutput`) actually holds on a live session, not
  just in the fixture.
- **The fetched content parsed exactly as `parseEnvironmentProbeFile` expects:**
  `version` (`3.12.12 (main, Jul 28 2026, ...)  [GCC 11.5.0 ...]`, single line —
  `sys.version`'s embedded newline was already flattened by the independent
  reviewer's fix, see above), `executable`
  (`/opt/sas/viya/home/sas-pyconfig/default_py/bin/python3`), and **259
  packages in 6833 bytes** — the identical package count and byte size finding
  62's own re-verification already recorded for `verde`, an independent
  confirmation that this deployment's installed set has not changed since.
- **Deleting the file worked once the correct media type was used for the
  properties read** (`application/vnd.sas.compute.file.properties+json`, per
  finding 68 — an initial guess at a generic `file+json` type answered with no
  `ETag` header, which is a probe-script mistake, not a `files.ts` one; the
  real `deleteSessionFile` already reads `getFileProperties` at its documented
  type). With the real `ETag`, the `DELETE` returned `204`, and a follow-up
  listing confirmed the file was actually gone — not just a `204` taken on
  faith.
- **The session ended cleanly (`204`)** with nothing left behind.

**What this settles:** the whole success path this project could not exercise
live before now — job submission, `SYSCC`, directory listing, content fetch,
delete, cleanup — behaves exactly as `procPython.ts`/`environment.ts` assume,
on Viya 4. **What this does not settle:** the `runtime-unavailable` failure
path (a deployment where `PROC PYTHON` genuinely does not work) is still
unmeasured — `verde` has `PROC PYTHON` licensed and working, so there was
nothing to fail against — and Viya 3.5 remains entirely unprobed for this
slice, same as the rest of Phase 3.

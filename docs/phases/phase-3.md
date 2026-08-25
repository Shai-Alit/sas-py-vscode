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
answer is [ADR-0011](docs/adr/0011-choosing-where-python-runs.md): each workspace
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

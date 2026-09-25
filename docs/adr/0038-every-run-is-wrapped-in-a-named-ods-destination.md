# ADR-0038 — Every run is wrapped in a named ODS HTML5 destination, and its body file is captured by name

- **Status:** Accepted — amended 2026-09-25 by
  [ADR-0039](0039-every-job-switches-syntax-check-mode-off.md): the job now
  starts with two syntax-check recovery lines, ahead of point 1's wrapper
- **Date:** 2026-09-24
- **Decides:** how `SAS.show()`, `SAS.pyplot()` and ODS output from
  `SAS.submit()` reach the result panel and a notebook cell; how the ODS
  body file is found, when it is shown, and when it is deleted; and what a
  notebook cell does with an SVG figure
- **Amends:** [ADR-0019](0019-rich-output-is-captured-by-diffing-the-working-directory.md)
  (its "every changed whitelisted file is a candidate" rule, and the
  "nothing may wrap or inject code around a user's own script" reading of
  its "Constrained by" line) and
  [ADR-0036](0036-notebook-html-output-is-sanitized.md) (what the sanitizer
  does with `<svg>`)
- **Constrained by:** [ADR-0014](0014-python-is-submitted-as-an-uploaded-file.md)
  (`Program.bytes` reaches the interpreter unmodified),
  [ADR-0015](0015-the-execution-backend-seam.md) (`RichOutput`'s arms),
  [ADR-0021](0021-result-panel-webview.md) (the result panel's CSP)
- **Executed in:** Phase 12 slice 12j
- **Evidence:** [`docs/phases/phase-12.md`](../phases/phase-12.md), Findings
  12.3 and 12.14–12.17

## Context

`PROC PYTHON`'s bridge object has display helpers: `SAS.show()` sends a
DataFrame, a native value or a matplotlib figure to "the results", and
`SAS.pyplot()` renders a figure. Under this extension's `infile=` submission
they run without error and show nothing, because no ODS destination is open
(Finding 12.14). A `proc print` a script submits through `SAS.submit()` goes
to the listing, which this extension never reads. SAS's own VS Code
extension opens a named ODS HTML5 destination before every run, which is
why the same call renders a figure there (Finding 12.3).

With that destination open around a run, the output lands as a body file in
the session's working directory, where ADR-0019's diff already looks
(Finding 12.14). Wrapping every run costs no measurable job time and leaves
`SYSCC` and the traceback as they were (Finding 12.15). Sean's decision
(2026-09-24): every run is wrapped, always, not behind a setting.

Two things made the capture more than "let the diff find it". ODS writes a
body on **every** run, 32,425 bytes of styling when nothing was shown. And
a cancelled run never closes its destination, so its file stays locked and,
without care, the next run either appends to it or leaves it behind to be
captured as that run's output (Finding 12.15).

## Decision

**1. The wrapper.** `procPython.ts`'s `runProgram` submits the job's code
array as:

```sas
ods listing gpath=%sysfunc(quote(%sysfunc(pathname(work))));
ods html5(id=vscode) close;
title;footnote;
ods graphics on / outputfmt=png;
ods html5(id=vscode) body='pyviya_ods.htm' options(bitmap_mode='inline' svg_mode='inline');
proc python infile=PY000001;   /* or: proc python restart infile=… */
run;
ods html5(id=vscode) close;
```

Since ADR-0039, two syntax-check recovery lines come before the first of
these.

- `ods listing gpath=…` sends the LISTING destination's graph images to
  WORK. LISTING is open by default, and with `ods graphics on` it writes a
  SAS procedure's graph as a `.png` into the working directory. ADR-0019's
  diff would then show that figure a second time (Finding 12.17).
- The `close` before the open releases a destination a cancelled run left
  open. On a fresh session it logs nothing (Findings 12.15, 12.16).
- `title;footnote;` clears a title an earlier `SAS.submit()` left.
- `outputfmt=png` makes a SAS procedure's graph a PNG. Under HTML5 the
  default is an inline SVG with its own `<script>` (Finding 12.17).

Only `execute()` is wrapped. `reset()` and `probeRuntime()` run no user
code and have nothing to show.

**2. The body file has a name we choose.** `body='pyviya_ods.htm'`, one
fixed name per session, rather than ODS's own `sashtml.htm`,
`sashtml1.htm`, … sequence. Each run's open overwrites it, and a cancelled
run's locked leftover is released by the next run's leading `close` and
overwritten by its open (Finding 12.16). The file to capture is known
before the run starts, so nothing depends on reading ODS's "Body file"
`NOTE`, which arrives typed `note` and would have to be read before the
log filter drops it.

**3. The body is not an ADR-0019 candidate.** `selectRichOutputCandidates`
skips it by name, although `.htm` is whitelisted. Instead, after the
ordinary candidates:

- It is **fetched unless its size is that of the last empty body** this
  backend fetched in the session. Every empty body measured the same size
  (Findings 12.15–12.17), so once one has been seen, a run that only prints
  fetches nothing. This is deliberately not ADR-0019's "changed during the
  run" test. Two different figures measured the same size (Finding 12.16),
  so a non-empty body left behind by a cancelled run, a failed fetch or a
  failed delete would make the next same-size figure read as unchanged and
  be dropped without a trace. A listing with no size never matches the
  empty size, so that body is always attempted.
- It is **shown only if it holds output**: at least one `id="IDX…"`
  anchor, the test upstream applies and every run in Findings 12.14–12.16
  bore out.
- It is **deleted only once shown.** An empty body stays for the next run
  to overwrite.
- It comes **after** the files the script wrote itself, as one `text/html`
  output. If it cannot be fetched, the ordinary ADR-0019 skip note names
  `pyviya_ods.htm`, which the user docs describe as the extension's own
  file. A note of its own would have been a sixth unlocalised string at
  the `RichOutput` seam, which `backend.ts` says should reopen ADR-0015's
  localisation boundary instead (PR #217 review).

Everything else ADR-0019 decided still applies to it: the 10 MiB cap, the
skip note on a failed fetch, capture on a failed run, no capture on a
cancelled one, a failed delete logged and not surfaced.

**4. SVG.** A SAS procedure's graph is a PNG, because of the wrapper's
`outputfmt=png` (Finding 12.17). `SAS.show(plt)` still embeds an inline
`<svg>` unless the call passes `filetype="png"`: matplotlib writes the
figure before ODS sees it, so no ODS option changes it (Finding 12.14).

- **Notebook cell:** the sanitizer drops an `<svg>` element with its whole
  subtree, text included. Before this, it dropped the tag and kept the
  text, so the figure showed as junk (`image/svg+xml`, the matplotlib
  version). SVG is not allowed through: it is a second markup language with
  its own script and link vectors, and ADR-0036's allow-list would need a
  parallel one for it. The user docs say to pass `filetype="png"`. A
  localised one-line note, passed in by the notebook controller, takes each
  dropped outermost `<svg>`'s place in SAS output (a body with an ODS output
  anchor). An SVG in other HTML is dropped with no note, since the note's
  `filetype="png"` advice would be wrong there. Without it the cell showed only
  `SAS.show`'s `title2 'Output'` banner above a gap (Finding 12.18).
  The body's `<style>` is dropped in a cell too; see "ODS styles" below.
- **Result panel:** it renders the SVG. ADR-0021's CSP already makes any
  `<script>` in it inert.

The two surfaces therefore disagree for an SVG figure. That is accepted:
the notebook is the surface whose output is saved and reopened without a
round trip, which is the reason ADR-0036 exists.

## Why this does not break ADR-0014

ADR-0019's "Constrained by" line summarised ADR-0014 as "nothing may wrap
or inject code around a user's own script". What ADR-0014 actually protects
is the script's **bytes**: they are uploaded to a fileref and read by
`proc python infile=`, never spliced into SAS source, so no escaping of the
user's Python is ever needed and none of its lines can end a `SUBMIT`
block early. The wrapper adds SAS statements to the job's code array
**around** the `proc python` statement, the same kind of addition as the
trailing `run;` ADR-0014's own amendment made (finding 70). The uploaded
bytes are unchanged, and the user's Python runs with the same namespace,
the same `SYSCC` and the same traceback (Finding 12.15).

## Alternatives considered

**Read the body name from the run's "Body file" `NOTE`.** What the 12h spike
first proposed. Rejected: it needs a `note`-typed line to be kept back from
the noise filter and to survive the log buffer caps, and it leaves empty
bodies and leftovers to be deleted on every run, which Finding 12.15 found
was most of the capture cost. (The spike said upstream reads the `NOTE`. It
does not: upstream's REST path reads the job's `results` collection, and
can name the body with `body=` as this ADR does.)

**Read the job's `results` collection**, upstream's route. Holds the same
bytes (Finding 12.14). Rejected: one more request per run, and a cancelled
run's leftover still needs handling separately.

**Opt-in, default off.** Considered until the empty-body skip and the
cancel path were proven. Sean chose always on, and Findings 12.15 and 12.16
found nothing against it.

**Allow sanitized SVG in notebooks.** Rejected for now; see point 4.

**`gpath=` on the HTML5 destination** to keep procedure images out of the
working directory. Probed and did not work: the side file is written by
the LISTING destination, not ours (Finding 12.17).

**`ods listing close;`** instead of redirecting LISTING's images. It also
removed the side file (Finding 12.17). Sean chose `gpath=` instead, which
leaves the LISTING destination open for code that relies on it.

## Consequences

- **Behaviour changes users will see.** `SAS.show()`/`SAS.pyplot()` output
  now appears. A `proc print` (or any ODS output) from `SAS.submit()` now
  appears as an HTML table, where it used to go nowhere. A user's own
  `ods _all_ close;` closes this destination too: that run's `SAS.show`
  logs `WARNING: No output destinations active.` and shows nothing, and
  the next run reopens it (Finding 12.15).
- **Titles reset.** `title;footnote;` runs before every run, so a `title`
  statement from an earlier `SAS.submit()` does not carry into the next
  run's output.
- **LISTING is redirected, and reopened.** `ods listing gpath=…` also opens
  LISTING if a user's code had closed it. A procedure graph's LISTING copy
  now lands in WORK. Those files pile up there until the session ends,
  since nothing reads or deletes them.
- **ODS styles.** The body carries two `<style>` blocks. Besides a few bare
  element selectors (`td, th { padding: 3px 6px }`, link colours), they hold
  dozens of unscoped class rules (`.output`, `.cell`, `.container`,
  `.note`, `.index`, …), most with a dark `color` (Finding 12.18).
  - **Notebook cell:** every output shares one webview document, and those
    class names collide with the notebook's own. In a dark theme another
    cell's text turned black while an ODS output was shown. A body with an
    ODS output anchor is therefore sanitized with **no** `<style>` at all,
    and its tables and titles take the notebook's own styling. Other HTML,
    such as a pandas `Styler` table, keeps its `<style>`.
  - **Result panel:** its own elements use `python-on-viya-` class names,
    which no ODS rule matches, so the styles are kept there. The bare
    element rules still reach the rest of the panel while that output is
    shown. This is cosmetic and accepted.
- **A DataFrame now has two routes**: `SAS.show(df)` renders an ODS table,
  and the data viewer (Phase 7) browses a table. The first arrives with the
  wrapper at no extra cost, and leaving it out would take code. It is kept.
- **The fixed name is reserved.** A script that writes its own
  `pyviya_ods.htm` into the working directory will have it overwritten.
- **Other Viya releases are unverified.** `SAS.show` needs 2025.03 or later.
  On an older release the wrapper still opens and closes an empty
  destination.

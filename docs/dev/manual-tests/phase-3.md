<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 3 (Run Python: the vertical slice)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## Run target: Local vs Viya — phase 3d-i

The target governs _where_ our commands appear, never what they do. An
unconfigured workspace is Local and contributes nothing to the editor
([ADR-0011](../../adr/0011-choosing-where-python-runs.md),
[ADR-0020](../../adr/0020-run-target-defaults-to-local.md)).

- [x] **3.1** **Fresh workspace is Local and invisible in the editor** — new folder, a
  `.py` file, nothing configured.
  **Expect:** the status bar names the target **Local**; there is **no** run
  icon of ours in the editor title bar, and our _Run File_ / _Run Selection_
  are absent from the editor context menu.
- [x] **3.2** **Select Run Target sets target + profile together** — **Select Run
  Target** → a Viya profile.
  **Expect:** one gesture sets both. Choosing **Local** again removes our editor
  contributions.
- [x] **3.3** **Viya target with no profile** — switch the target to Viya before picking
  a profile, then try to run.
  **Expect:** a “no profile selected” readiness state — you are told to pick
  one, not dropped back to Local. **Note (2026-08-27):** with one or more
  profiles already configured, the picker doesn't actually offer a bare
  "Viya, no profile" state — choosing Viya always selects a profile in the
  same gesture. Confirmed as acceptable, intentional UX (not a defect) — the
  literal no-profile state is really only reachable from a completely
  profile-less workspace.
- [x] **3.4** **Editor button merges with `ms-python`, not doubles** — target = Viya,
  folder trusted, `ms-python.python` installed, a `.py` file open.
  **Expect:** one play button with a dropdown chevron, not two side by side.
  Note which command the tooltip names as primary, and that it does not flip
  around as you use the dropdown. **(known gap)** no keybinding ships — palette
  / button / menu only. Confirmed 2026-08-27: no doubles — **Run File** runs
  on Viya, **Run Python File** runs locally.
- [x] **3.5** **Context-menu entries gated correctly** — right-click with Viya +
  trusted, then Local, then untrusted.
  **Expect:** our _Run File_ / _Run Selection_ appear only under Viya + trusted.
- [x] **3.6** **Flipping the target changes placement only** — toggle Local ↔ Viya,
  invoking _Run File_ from the palette each time.
  **Expect:** the command always means the same thing; only whether it also
  appears in the editor changes.


## Running Python: text output — phases 3a, 3b

- [x] **3.7** **(live) Hello world streams clean** — a file that is
  `print("hello from viya")` → **Run File**.
  **Expect:** a run header, then `hello from viya` as plain stdout, then a
  “Finished” line, with **no SAS NOTEs** and **no page-break banners**
  (`PAGESIZE=MAX`, 3f). The interpreter startup banner
  (`Python 3.12.12 … / Type "help" …`) **does** appear on a **Run File** (which
  restarts the interpreter first) and on the **first Run Selection after
  connect / Reset Python State**; bare `>>>` prompt markers appear on **every**
  run of either command. Both are `PROC PYTHON`'s own interactive-REPL output —
  **known, accepted, not a defect.**
  **Settled 2026-09-09 (Finding 93, `docs/phases/phase-5.md`; Phase 5→6
  housekeeping):** this is Finding 74's sub-finding (a). A live probe pulled
  `PROC PYTHON`'s full option list off the deployment's own syntax-error
  enumeration — `COMMAND ECHO INFILE RESTART SRC TERMINATE TIMEOUT` — and
  **none suppresses the banner or `>>>`** (`ECHO` only adds a source echo).
  There is no `PAGESIZE=MAX`-style fix. Decision: accept and document rather
  than filter `normal`-typed lines client-side (a program may legitimately
  `print(">>> …")`). This box's assertion is reworded accordingly; do not
  re-flag the banner/`>>>` as a regression.
- [x] **3.8** **(live) Submission fidelity — run the whole corpus.** Open each file under
  `test/fixtures/submission-corpus/` and **Run File**:

  ```
  apostrophe-in-docstring.py         fstring-nested-quotes-braces.py
  ampersand-percent-in-literals.py   crlf-line-endings.py
  non-ascii.py                       tab-indented.py
  no-trailing-newline.py             odd-quote-count.py
  triple-quote-mixed-styles.py       raw-and-byte-strings.py
  semicolon-heavy-oneliner.py        endsubmit-in-string.py
  endsubmit-in-comment.py            empty.py
  utf8-bom.py
  ```

  **Expect:** every file runs and does exactly what the code means — no quoting
  artefact, no truncation, no “it ran but meant something else”. These are the
  silent-failure cases the corpus exists for. **Confirmed clean, 2026-08-27** —
  all 14 fixture files round-tripped byte for byte, no quoting/truncation
  defects. A stray "The SAS System …" banner line did bleed into 4 of the 14
  runs' output — the same root cause as "Large output stays clean" below, not
  a separate corpus defect; tracked once there, not twice.
  `utf8-bom.py` was added with slice 5d-ii (2026-09-02) and is **not** covered
  by the 2026-08-27 run; its live upload + `infile=` behaviour is separately
  established by Finding 77 (`docs/phases/phase-5.md`), and it should be folded
  into the next full corpus run here.
- [x] **3.9** **(live) Run File starts a fresh namespace each time** — **Run File** a
  file that is just `a = 41`; then **Run File** a file that is just `print(a)`.
  **Expect:** `NameError` — every _Run File_ runs with `freshNamespace: true`.
- [x] **3.10** **(live) Run Selection builds on state like a cell** — select `b = 41` →
  **Run Selection**; then select `print(b + 1)` → **Run Selection**.
  **Expect:** `42` — a selection runs against the live namespace
  (`freshNamespace: false`).
- [x] **3.11** **(live) Reset Python State really restarts the interpreter** — after the
  previous item, run **Reset Python State**, then select `print(b)` → **Run
  Selection**.
  **Expect:** `NameError`.
- [x] **3.12** **(live) Failure is detected, not swallowed** — run a file whose top level
  raises (`raise RuntimeError("nope")`).
  **Expect:** reported as failed, not “Finished”; the error text is in the log.
  The interpreter banner and `>>>` markers may appear here too — same known
  `PROC PYTHON` behaviour as the "Hello world streams clean" item above, not
  error-path-specific (the earlier "only observed on the error path" reading
  was wrong — see the 5d-iii refinement and Finding 93). **Closed
  2026-09-09:** the redundant-echo half was fixed in **5d-iii**; the
  transcript-noise half is settled by **Finding 93** — no `PROC PYTHON` option
  suppresses it, accepted and documented rather than filtered. Finding 74 is
  fully closed.
- [x] **3.13** **(live) Large output stays clean** — run `for i in range(5000): print(i)`.
  **Expect:** all 5000 lines, in order, no pagination header bleeding into the
  stream. **Failed, 2026-08-27** — the "The SAS System …" page-break banner
  bled into the stream roughly every 58 lines. Root cause: `isNoiseLine`
  (`src/backend/logFilter.ts`) doesn't exclude `title`-typed log lines, and
  `PAGESIZE=MAX` still isn't sent at session creation — both already named as
  an open gap in `logFilter.ts`'s own doc comment (Finding 63) but never
  picked up as a fix. Tracked in Phase 3's **3f** slice.
- [x] **3.14** **(live) Busy session refuses a second submission** — start the long run
  below, then try **Run File** again.
  **Expect:** refused with an “already running” message.
- [x] **3.15** **(live) Cancel, both ways** — run:

  ```python
  import time
  print("start")
  time.sleep(60)
  print("done")
  ```

  Cancel from the progress notification's **Cancel** button; repeat and cancel
  via the **Cancel** command in the palette.
  **Expect:** both stop the run; `done` never prints. The notification really
  does show a Cancel button (Notification-location progress, not Window). The
  output channel's cancellation line reads **"Cancelled. If a single step was
  already running, SAS Viya may keep executing it until that step finishes on
  its own."** (reworded in phase 4c per Finding 76), and **no error
  notification** appears — a clean cancel means the server accepted the
  `If-Match`'d state `PUT` rather than the `428` a bare request drew before
  the 4c fix (Finding 75).
  **Re-verified 2026-09-01** against `verde` with a `.vsix` from
  `phase-4c-traceback-and-cancel-fix`: both cancel paths as above, reworded
  message shown, no error toast. A run submitted ~15 s into the `sleep`
  immediately after a cancel completed cleanly ~30–40 s later — the cancelled
  step ran out its natural duration before the session freed (Finding 76),
  with no corruption and no reconnect needed.


## Tracebacks — phase 3c-ii

- [x] **3.16** **(live) Wrapper frames are dropped, yours are kept** — run:

  ```python
  def inner():
      raise ValueError("boom")

  def outer():
      inner()

  outer()
  ```

  **Expect:** a traceback showing `outer` then `inner` and `ValueError: boom`.
  The harness's leading `<stdin>` wrapper frames at the top are gone.
- [x] **3.17** **(live) Deep / recursive stacks survive** — run a bare recursion, no
  test framework:

  ```python
  def recurse(n):
      return recurse(n + 1)

  recurse(0)
  ```

  **Expect:** a `RecursionError` traceback with the repeated `recurse`
  frames all present — only the _leading_ contiguous run of harness frames
  is removed — and the session still alive for the next submission.
  **Passed 2026-08-31** against a `.vsix` from
  `phase-3f-manual-test-regressions`: a clean
  `RecursionError: maximum recursion depth exceeded`, "Finished with an
  error.", session unharmed. The stream showed the `<stdin>` wrapper
  frame, then `<string>` line 4 (`recurse(0)`), then ~998 `recurse`
  frames collapsed by Python's own `[Previous line repeated 995 more
  times]` — repeats preserved, nothing over-trimmed. (Confirm the leading
  `<stdin>` frame is dropped in the **Result panel**'s structured
  traceback, which is where 3c-ii does that — the output-channel stream
  keeps it.)

  *History.* Both earlier runs used a 5-case `unittest` script
  (`test_deep_stack_trim.py`). **2026-08-27 and again 2026-08-30, same
  script:** all 5 frame-trimming assertions passed, then the Python
  subprocess crashed ("trying to use more memory than the container is
  configured to allow") immediately after. That crash is **not** recursion
  depth — the script caps `sys.setrecursionlimit(200)` — and did not
  reproduce with the minimal script above, so it was the test harness
  itself (`unittest.main()` calling `sys.exit()` inside `PROC PYTHON`,
  five `setUp` calls re-running the capture), not this item's behaviour.
  Resolved. **Separate observation from this run:** the failing run's
  stream also carried the Python interpreter banner and `>>>` prompt
  markers, which §6 says should never appear — split out as its own
  open item in Phase 3's **3f** slice, not a blocker for this box.
  **Update (5d-iii, 2026-09-02):** the redundant traceback-tail echo this
  run also showed is fixed — verified live, see the dedicated row below. The
  banner/`>>>` transcript noise stays open as a live-Viya probe follow-up
  (see §6's "Failure is detected" note and `phase-5.md`'s Runbook item 3).

## Rich output: matplotlib and pandas — phases 3c-i, 3d-ii

Capture is a before/after diff of the session's working directory
([ADR-0019](../../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)) —
your script must actually write a `.png` or `.html` file; there is no implicit
`savefig`. Output lands in the Result panel, a single CSP-locked webview
([ADR-0021](../../adr/0021-result-panel-webview.md)).

- [x] **3.18** **(live) matplotlib figure renders in the panel** — run:

  ```python
  import matplotlib
  matplotlib.use("Agg")
  import matplotlib.pyplot as plt

  fig, ax = plt.subplots()
  ax.plot([0, 1, 2, 3], [10, 5, 8, 2], marker="o")
  ax.set_title("Live test figure")
  fig.savefig("live_fig.png", dpi=120)
  print("figure written")
  ```

  **Expect:** the run finishes; the **Result panel** opens and shows the PNG
  with alt text; the output channel also gets a short “rich output produced”
  line alongside `figure written`.
- [x] **3.19** **(live) pandas HTML renders as a real table** — run:

  ```python
  import pandas as pd

  df = pd.DataFrame(
      {"pkg": ["pandas", "numpy", "swat"], "installed": [True, True, False]}
  )
  df.to_html("live_table.html", index=False)
  print(df)
  ```

  **Expect:** stdout shows the text frame; the panel renders a selectable HTML
  `<table>` — markup survives as a table, not an image.
- [x] **3.20** **(live) Multiple figures, ordered and numbered** — a loop writing
  `fig_0.png`, `fig_1.png`, `fig_2.png`.
  **Expect:** all three in the panel, in filename order, after the text output,
  numbered.
- [x] **3.21** **(live) Panel is a singleton** — run another rich output with the panel
  already open.
  **Expect:** the same panel is reused, never a second one — meaning its
  content is **replaced**, not appended to. Confirmed 2026-08-27: re-running a
  rich output clears the existing panel and writes the new one in its place;
  this is the intended behavior, not a bug.
- [x] **3.22** **(live) Reveal policy** — run a text-only script; then one producing an
  image; then a run that only fails.
  **Expect:** text-only (fully visible in the output channel) does **not** pop
  the panel; an image / HTML / structured traceback does; an outcome-only or
  failure-only run never opens it.
- [x] **3.23** **(live) Re-reveal for a later run** — leave the panel open but click back
  into the editor so it is unfocused; run another matplotlib script.
  **Expect:** the panel comes back to the front — not only for the run that
  first created it. _(Regression: this was a fixed bug.)_
- [x] **3.24** **(live) Oversize output is skipped, not fatal** — write a `.png` bigger
  than 10 MiB without asking the session for gigabytes of render buffer to
  do it:

  ```python
  import matplotlib
  matplotlib.use("Agg")
  import matplotlib.pyplot as plt
  import numpy as np

  fig, ax = plt.subplots(figsize=(20, 20))
  ax.imshow(np.random.rand(3000, 3000))
  fig.savefig("oversize.png", dpi=200)
  print("wrote an oversize figure")
  ```

  **Expect:** the run finishes and its stdout is shown; a “could not
  retrieve rich output file …” note appears in place of the figure,
  naming the file and the size cap; the session stays alive and the next
  selection runs normally. **Passed 2026-08-31** against a `.vsix` from
  `phase-3f-manual-test-regressions`: the run returned
  `[could not retrieve rich output file "oversize.png": it is larger than
  the 10485760-byte capture limit]` in place of the figure, and a
  following `import matplotlib` selection ran normally on the same
  session — the skip path (ADR-0019 point 8) works as designed once the
  script does not OOM the container first.

  *History.* The 2026-08-27 pass skipped this item — the wording then gave
  no way to make a file this large. The 2026-08-30 pass ran it against a
  **different** script (`figsize=(40, 40)`,
  `imshow(np.random.rand(4000, 4000, 3))`, `dpi=300`) and it did not skip:
  the run failed with an HTTP 500 on the job-log poll and the compute
  session was gone afterward (Finding 73). Root cause is that script, not
  the cap — it allocates ~384 MB for the array and renders a ~1.7 GB
  canvas, so the container is out of memory inside `savefig` before any
  file exists to skip. ADR-0019's cap guards the *transfer* of a written
  file, never a script's own memory use during generation — see that
  ADR's 2026-08-30 amendment. The script above is sized to exercise the
  skip path the cap actually owns.

  *Separate known limitation, tracked in Phase 3's **3f** slice:* a script
  whose figure generation exhausts the session container kills the
  session mid-run, surfacing as a job-log 500 then a session 404. That is
  an out-of-memory kill like any other, outside this item's scope; a
  friendlier message for it is an open question, not a decided fix.
- [x] **3.25** **(live) Cancelled run captures nothing** — a script that writes a figure
  then `time.sleep(60)`; cancel it.
  **Expect:** no image captured — the after-snapshot is skipped on a cancelled
  outcome. Confirmed 2026-08-27. **Follow-up raised, not a failure of this
  item:** by design (ADR-0019), a cancelled run never reads back *or deletes*
  whatever partial file was written before cancellation, so it can be
  orphaned in the session's working directory. Tracked as a documentation
  item in Phase 3's **3f** slice — ADR-0019 should say this explicitly rather
  than leaving it implicit.
- [x] **3.26** **(known gap) Reload loses the panel content** — with the panel populated,
  reload the window.
  **Expect:** the content is gone. No `WebviewPanelSerializer` yet — same as the
  output channel losing scrollback.
- [x] **3.27** **(live) Accessibility and theming** — tab through the panel; switch VS
  Code between light, dark, and a high-contrast theme.
  **Expect:** image alt text; the table is a navigable table; a traceback is a
  heading, a message, and a genuine ordered list of frames. Legible in every
  theme; loads nothing from the network (CSP-locked).

## Environment and package list — phase 3e

A slow answer that changes rarely — probed on demand, cached per profile in
global state, refreshed explicitly.

- [x] **3.28** **(live) Show Environment opens the list** — run **Show Environment** (or
  click the second status-bar item, right of the profile).
  **Expect:** a read-only virtual document: interpreter version and path, then
  installed distributions with versions (from `importlib.metadata`, not `pip`).
  Ctrl/Cmd-F searches it; it splits alongside code.
- [x] **3.29** **(live) Refresh updates an open tab in place** — with the document open,
  run **Refresh Environment Info**.
  **Expect:** it re-probes and the open tab shows the fresh answer (no new tab).
- [x] **3.30** **(live) Per-profile cache** — Show Environment on profile A; switch to B
  and Show Environment (it probes); switch back to A.
  **Expect:** A's list returns instantly from cache — keyed on profile id.
- [x] **3.31** **(live) Cache persists across reload** — reload the window, then Show
  Environment.
  **Expect:** still instant — the cache is `globalState`. A fresh window with a
  cached answer should not connect just to render it.
- [x] **3.32** **(live) Probing has no side effects on your namespace** — run selection
  `z = 1`; force a **Show Environment** refresh; run selection `print(z)`.
  **Expect:** `1` — the probe neither restarts the interpreter nor leaves
  `sys` / `json` / `importlib` bound in your namespace.
- [x] **3.33** **(live) Shares the serial contract** — trigger **Show Environment** while
  a run is in flight.
  **Expect:** refused, as a second run would be — there is just nothing to
  cancel it with.
- [x] **3.34** **(live) A big list renders whole** — on a stock Viya 4 the list can run
  to a few hundred entries (~250+). To actually see this: run **Show
  Environment** against a profile with `numpy`/`pandas`/`matplotlib`/`scipy`
  installed (each pulls in a long dependency chain) — `verde` measured 259
  packages during Phase 3e's own live probe, a realistic stand-in for "a few
  hundred."
  **Expect:** the whole list renders; a distribution with broken `METADATA` is
  skipped rather than blanking or crashing the probe. *(Not run 2026-08-27 —
  the previous wording gave no concrete way to reach "a big list"; use the
  profile/package guidance above.)*


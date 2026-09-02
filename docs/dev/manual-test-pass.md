<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass

The three tiers in [Testing](testing.md) prove the extension calls the right
things in the right order. None of them proves a person can install the built
`.vsix`, point it at a real deployment, and get a figure back. This page is that
proof: a scripted walkthrough of every user-visible behaviour shipped so far,
run by hand against a live Viya 4 deployment with the packaged extension
installed.

Run it before a release ([release checklist](../release-checklist.md) D6), and
again whenever a phase closes — see [Keeping this current](#keeping-this-current)
at the end.

The steps are derived from the phase files (`docs/phases/phase-0` … `phase-3`)
and the ADRs they cite. Each **Expect** line is an assertion, not a
documentation claim: if one turns out wrong, that is either a bug or a stale line
here, and the fix is whichever it is.

**Last full pass: 2026-08-27**, against live `verde`/`Innov` profiles with the
packaged `.vsix` — the first full run since Phase 3 closed. Findings triaged
2026-08-28; three confirmed regressions it found are tracked as Phase 3's
**3f** slice in `docs/phases/phase-3.md` rather than repeated here — this
page only records what to re-check and how, not the fix itself.

**Second pass completed 2026-08-30**, against the same `verde`/`Innov`
profiles with a `.vsix` built from `phase-3f-manual-test-regressions`
(still unmerged) — the checkboxes below reflect it. Confirms that slice's
fixes for Cold-start Connect, Idle reap, Sign Out (both places it's
checked), Failures are diagnosable, Large output stays clean, and the
reworded Cancel/`defaultProfile`/Shared-sessions items. It also surfaced
three new findings — not carried over from the 2026-08-27 triage, and not
covered by this slice's fixes as they then stood: Reload reconnects now
fails a different way (§4), the deep-recursion container crash reproduces
on retry (§7), and Oversize output kills the session instead of skipping
cleanly (§8) — annotated inline below and added to Phase 3's **3f** slice
(Findings 72–73 in `docs/phases/phase-3.md`).

**Follow-up, 2026-08-31.** Findings 72 (§4), 73 (§8) and the
deep-recursion crash (§7) are all resolved and **verified live** against a
`.vsix` from `phase-3f-manual-test-regressions`: `print(k)` after a reload
returns on the first attempt; the reworded oversize script returns the
"could not retrieve rich output file …" note and the session survives;
and a minimal recursion gives a clean `RecursionError` with the session
unharmed — the earlier §7 crash was `test_deep_stack_trim.py`'s own
`unittest` harness, not `PROC PYTHON`. One **new** open item came out of
the §7 run: a failing run's output stream carries the Python interpreter
banner and `>>>` prompt markers (§6 says it should not) — split into its
own item in Phase 3's **3f** slice for later.

**Targeted re-check, 2026-09-01** (not a full pass) — for phase 4c, against
`verde` with a `.vsix` from `phase-4c-traceback-and-cancel-fix`: §6's
"Cancel, both ways" re-verified for the reworded cancellation message and
the now server-accepted (`If-Match`'d) job cancel, plus the queued-run
behaviour Finding 76 predicts. §7's `ModuleNotFoundError` row is rewritten
from a `(known gap)` into a real assertion — 4c implemented the Show
Environment pointer, and it is verified live (the appended sentence shows on
the diagnostic).

**Targeted re-check, 2026-09-02** (not a full pass) — for phase 4d, against
`verde` with a `.vsix` from `phase-4d-diagnostics-surface`: §7's new
"failed run lands in the Problems panel" and §8's "traceback frames jump to
the editor" both verified live — the Problems entry lands on the mapped
line, clears on a clean re-run, follows a selection's `lineOffset`, and is
absent for a SAS-side failure with no Python traceback; a `<string>`
traceback frame in the Result panel is a keyboard-reachable button that
reveals its line in the editor column, and a library-path frame is not
interactive.

## How to use this

- The lists are GitHub task lists. Tick them in a preview, or copy a section into
  a release issue and tick it there.
- Tags on an item:
  - **(live)** — needs a real deployment answering; can't be done offline.
  - **(slow)** — optional, or minutes to observe. Skip on a quick pass.
  - **(known gap)** — documented as not-done-yet. The behaviour described is the
    _current_ intended one; it is not a bug. If it ever changes, update the row.
- Keep **Python on Viya: Show Log** open in the Output panel for the whole pass
  and watch it for anything logged at error level.

---

## 0. Pre-flight

- [x] **Build the VSIX** — `npm run package` from the repo root.
  **Expect:** `vsce package` writes `dist/python-on-viya.vsix` and
  `check:package` passes (the manifest lists ~10 entries, LICENSE and NOTICE
  included).
- [x] **Install it into a real VS Code** — Extensions view → **⋯** → **Install
  from VSIX…**, or `code --install-extension dist/python-on-viya.vsix`. Reload.
  **Expect:** “Python on Viya” shows as installed; no activation error.
- [x] **Install `ms-python.python`** in the same window.
  **Expect:** needed for completion/hover (editing intelligence is delegated)
  and for the editor run-button check in §5.
- [x] **Open a trusted folder with a `.py` file.** Have a Viya 4 deployment
  reachable and know one compute context whose SAS server has the Python
  interpreter configured.
- [x] **Open the log** — run **Python on Viya: Show Log** and dock it.
  **Expect:** a clean “Python on Viya activated.” line.

## 1. Activation and logging

- [x] **Activates on startup**, no command needed. Reload and wait.
  **Expect:** activation on `onStartupFinished`; nothing alarming in the log.
- [x] **The palette only offers what is valid now.** Type “Python on Viya”.
  **Expect:** with no profile and a Local target you see _Add Connection
  Profile_, _Import Connection Profiles…_, _Select Run Target_, _Show Log_ —
  and **not** _Connect_, _Disconnect_, _Cancel_. Unavailable commands are
  omitted, not greyed.

## 2. Connection profiles — phase 1a

The profile _model_ is validated whether you use the commands or hand-edit
`settings.json`. Secrets never live in settings.

- [x] **Add a profile** — a name, an `https://…` endpoint, context and client id
  left empty.
  **Expect:** “Added connection profile …” toast; the status bar shows the name.
- [x] **Endpoint validation rejects the dangerous shapes** — try
  `http://viya.example.com` (non-loopback http) and `https://user:pw@host`.
  **Expect:** both refused with a specific reason (token readable over http;
  credentials do not belong in a settings file).
- [x] **Settings shape is right** — inspect `pythonOnViya.connectionProfiles`.
  **Expect:** keyed by name, each entry carrying a `version` and a generated
  `id`, and **no** client secret anywhere.
- [x] **Hand-editing is picked up and re-validated** — change a profile's
  endpoint in `settings.json`, then break another (drop the scheme).
  **Expect:** the valid edit takes effect; the broken one is ignored with a log
  line naming which and why, not a whole-setting failure.
- [x] **`defaultProfile` vs Switch** — `pythonOnViya.defaultProfile` is a
  **Settings UI / `settings.json` value, not a command** — it will never appear
  in the Command Palette by design (confirmed against `package.json`'s
  `contributes.configuration`; the 2026-08-27 pass looked for it in the
  Palette and reasonably didn't find it). Set it via **Settings → search
  "Python on Viya" → Default Profile**, or `settings.json` directly, then
  reload; then **Switch Connection Profile** to another.
  **Expect:** a fresh window starts on `defaultProfile`; switching overrides it
  for this window only and does not rewrite the setting. *(Not yet re-run
  against the corrected steps — do that before ticking this box.)*
- [x] **Edit and Delete** — **Edit Connection Profile** (change endpoint, leave
  the secret prompt blank); **Delete Connection Profile**.
  **Expect:** edit updates in place and keeps the stored secret; delete removes
  the entry and drops its secret from secret storage.
- [x] **(slow) One-time import from the SAS extension** — only if that extension
  is installed with profiles: **Import Connection Profiles from the SAS
  Extension**.
  **Expect:** Viya profiles copied once; non-Viya kinds skipped.

## 3. Sign in — phase 1b

- [x] **(live) OAuth2 + PKCE round trip** — run **Sign In**.
  **Expect:** the system browser opens SASLogon; you land back in VS Code. On a
  stock Viya 4 that is the paste-box arm; the URI-handler arm only fires with an
  admin-registered client. Signing in also opens a compute session.
- [x] **(live) Empty client id uses the built-in client** — profile with
  `clientId` empty.
  **Expect:** the built-in `vscode` client on Viya 4 2022.11+. On 3.5 / older 4
  you are told, in those words, to supply an id and secret. _(Viya 3.5 is
  unverified — treat as untested.)_
- [x] **Sign out** — run **Sign Out**, then trigger a run.
  **Expect:** you are taken back through authentication. **Failed, 2026-08-27**
  — clicking **Run File** after sign-out silently fails instead ("The program
  could not be sent to SAS Viya…", nothing in the log, no re-auth prompt).
  Root-caused and tracked as Phase 3's **3f** slice (`docs/phases/phase-3.md`)
  — re-run this item once that lands.
- [x] **(live) (slow) Proxy / internal CA** — only if applicable: sign in as
  normal.
  **Expect:** it completes; proxy and OS/internal certificate trust are
  inherited from the extension host.
- [ ] **(live) User-provided CA certificate — phase 5d-i** — only on a
  deployment whose chain the OS does *not* already trust (an incomplete chain,
  or a private root not installed locally). First sign in with
  `pythonOnViya.userProvidedCertificates` unset.
  **Expect:** sign-in fails before authentication with a TLS error
  (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `unable to verify the first
  certificate`) in the **Python on Viya** log. Then set the setting to the PEM
  path for the missing authority, reload the window, and sign in again.
  **Expect:** sign-in completes and a run works — the same dedicated agent is
  on both paths. Add a second, bogus path to the array and reload.
  **Expect:** a single **Could not read the CA certificate at …** warning in
  the log, naming that path, and sign-in still works on the good one.

## 4. Connect and the compute session — phase 2a

One session per folder, per profile ([ADR-0012](../adr/0012-compute-session-lifetime-and-storage.md)).
Reload reconnects; it does not restart.

- [x] **(live) Cold-start Connect** — signed out, run **Connect to SAS Viya**.
  **Expect:** it signs you in first, shows a progress notification while the
  session opens, then an info message naming the profile. **Failed,
  2026-08-27** — while signed out, **Connect to SAS Viya** does not appear in
  the palette at all; **Sign In** has to be run manually first, and only then
  does Connect appear. Tracked in Phase 3's **3f** slice alongside the other
  "Connect won't come back" findings below — re-run once that lands.
- [x] **(live) Context picker and write-back** — profile with no `context`: the
  first connect lists contexts. Dismiss it once; connect again and pick a
  working one.
  **Expect:** dismiss → connect cancels, nothing written. After a session
  actually starts, `context` is written back into the profile in
  `settings.json`.
- [x] **(live) Reload reconnects with state intact** — run selection `k = 99`
  (see §6). Reload the window. Run selection `print(k)`.
  **Expect:** `99` — you re-attached to the same interpreter. **Failed,
  2026-08-27** — a window reload lost the Viya connection and left **Connect**
  missing from the palette (same underlying cause as Cold-start Connect and
  Idle reap below — see Phase 3's **3f** slice). **Retested 2026-08-30
  against the 3f fix build: Connect no longer goes missing, but the first
  submission after reload still failed** — a fileref collision ("`py000001`
  already exists", error 5402), reproduced one fileref number later after
  **Reset Python State**, clearing on its own after roughly 60–90 seconds
  (Finding 72). **Root-caused and fixed 2026-08-31** on
  `phase-3f-manual-test-regressions`: the backend now seeds its per-run
  fileref counter from the session's own `filerefs` collection on the
  first run after reconnecting, so it never re-issues a name the
  reattached session already holds, with a bounded assign-retry as a
  backstop. **Re-verified live 2026-08-31** against a `.vsix` from this
  branch: `k = 99`, reload, `print(k)` returns `99` on the first attempt
  with no delay.
- [x] **(live) Disconnect ends it now** — run **Disconnect from SAS Viya**, then
  run selection `print(k)` again.
  **Expect:** a fresh interpreter opens and `k` is gone (`NameError`).
- [x] **(live) Shared vs independent sessions** — a plain **File → Open
  Folder** on an already-open folder just refocuses the existing window — VS
  Code's own behavior, not this extension's, and it is *not* a second window.
  To actually get two independent windows on the same folder, open a terminal
  and run `code -n <folder>` (or use **File → Duplicate Workspace**), *then*
  set a var in one, read it in the other, and switch to a second profile and
  connect in the second window.
  **Expect:** same folder + same profile → one shared session; a different
  profile → its own, the first undisturbed. *(The 2026-08-27 pass used a plain
  Open Folder and was correctly kicked back to the original window — not a
  defect, but not a real test of this item either. Re-run with `code -n`
  before ticking this box.)*
- [x] **(live) (slow) Idle reap** — connect, leave idle past the deployment
  timeout (15 min default).
  **Expect:** the next connect silently opens a fresh interpreter — the stale
  session id is a hint, not a fact, and you are not prompted. **Failed,
  2026-08-27** — same as Cold-start Connect and Reload above: **Connect**
  doesn't reappear in the palette after the reap is detected; only running
  **Disconnect** first brings it back. Tracked in Phase 3's **3f** slice.
  **Retested 2026-08-30 against the 3f fix build: passes** — the next
  connect after a reap silently opens a fresh interpreter, and **Connect**
  never goes missing from the palette. Confirms the connected-key fix for
  this symptom; unlike Reload (above), no new defect turned up here.
- [x] **(live) Error surfaces read sensibly** — reach what you can: Viya target
  with no active profile; a context you can see but cannot launch; Cancel
  mid-connect.
  **Expect:** “Select a … profile”; a two-readings message; **silence** after
  Cancel. **Show Log** carries status codes and correlation ids.

## 5. Run target: Local vs Viya — phase 3d-i

The target governs _where_ our commands appear, never what they do. An
unconfigured workspace is Local and contributes nothing to the editor
([ADR-0011](../adr/0011-choosing-where-python-runs.md),
[ADR-0020](../adr/0020-run-target-defaults-to-local.md)).

- [x] **Fresh workspace is Local and invisible in the editor** — new folder, a
  `.py` file, nothing configured.
  **Expect:** the status bar names the target **Local**; there is **no** run
  icon of ours in the editor title bar, and our _Run File_ / _Run Selection_
  are absent from the editor context menu.
- [x] **Select Run Target sets target + profile together** — **Select Run
  Target** → a Viya profile.
  **Expect:** one gesture sets both. Choosing **Local** again removes our editor
  contributions.
- [x] **Viya target with no profile** — switch the target to Viya before picking
  a profile, then try to run.
  **Expect:** a “no profile selected” readiness state — you are told to pick
  one, not dropped back to Local. **Note (2026-08-27):** with one or more
  profiles already configured, the picker doesn't actually offer a bare
  "Viya, no profile" state — choosing Viya always selects a profile in the
  same gesture. Confirmed as acceptable, intentional UX (not a defect) — the
  literal no-profile state is really only reachable from a completely
  profile-less workspace.
- [x] **Editor button merges with `ms-python`, not doubles** — target = Viya,
  folder trusted, `ms-python.python` installed, a `.py` file open.
  **Expect:** one play button with a dropdown chevron, not two side by side.
  Note which command the tooltip names as primary, and that it does not flip
  around as you use the dropdown. **(known gap)** no keybinding ships — palette
  / button / menu only. Confirmed 2026-08-27: no doubles — **Run File** runs
  on Viya, **Run Python File** runs locally.
- [x] **Context-menu entries gated correctly** — right-click with Viya +
  trusted, then Local, then untrusted.
  **Expect:** our _Run File_ / _Run Selection_ appear only under Viya + trusted.
- [x] **Flipping the target changes placement only** — toggle Local ↔ Viya,
  invoking _Run File_ from the palette each time.
  **Expect:** the command always means the same thing; only whether it also
  appears in the editor changes.

## 6. Running Python: text output — phases 3a, 3b

- [x] **(live) Hello world streams clean** — a file that is
  `print("hello from viya")` → **Run File**.
  **Expect:** a run header, then `hello from viya` as plain stdout, then a
  “Finished” line. No SAS NOTEs, no page-break banners, no `>>>` markers.
- [x] **(live) Submission fidelity — run the whole corpus.** Open each file under
  `test/fixtures/submission-corpus/` and **Run File**:

  ```
  apostrophe-in-docstring.py         fstring-nested-quotes-braces.py
  ampersand-percent-in-literals.py   crlf-line-endings.py
  non-ascii.py                       tab-indented.py
  no-trailing-newline.py             odd-quote-count.py
  triple-quote-mixed-styles.py       raw-and-byte-strings.py
  semicolon-heavy-oneliner.py        endsubmit-in-string.py
  endsubmit-in-comment.py            empty.py
  ```

  **Expect:** every file runs and does exactly what the code means — no quoting
  artefact, no truncation, no “it ran but meant something else”. These are the
  silent-failure cases the corpus exists for. **Confirmed clean, 2026-08-27** —
  all 14 fixture files round-tripped byte for byte, no quoting/truncation
  defects. A stray "The SAS System …" banner line did bleed into 4 of the 14
  runs' output — the same root cause as "Large output stays clean" below, not
  a separate corpus defect; tracked once there, not twice.
- [x] **(live) Run File starts a fresh namespace each time** — **Run File** a
  file that is just `a = 41`; then **Run File** a file that is just `print(a)`.
  **Expect:** `NameError` — every _Run File_ runs with `freshNamespace: true`.
- [x] **(live) Run Selection builds on state like a cell** — select `b = 41` →
  **Run Selection**; then select `print(b + 1)` → **Run Selection**.
  **Expect:** `42` — a selection runs against the live namespace
  (`freshNamespace: false`).
- [x] **(live) Reset Python State really restarts the interpreter** — after the
  previous item, run **Reset Python State**, then select `print(b)` → **Run
  Selection**.
  **Expect:** `NameError`.
- [x] **(live) Failure is detected, not swallowed** — run a file whose top level
  raises (`raise RuntimeError("nope")`).
  **Expect:** reported as failed, not “Finished”; the error text is in the log.
  **Open, 2026-08-31:** the §7 recursion run showed a *failing* run's
  output stream also carrying the Python interpreter banner
  (`Python 3.x … Type "help" …`) and `>>>` prompt markers — which the
  "Hello world streams clean" item above says should never appear. Only
  observed on the error path so far (successful runs stay clean). Split
  out as its own item in Phase 3's **3f** slice.
- [x] **(live) Large output stays clean** — run `for i in range(5000): print(i)`.
  **Expect:** all 5000 lines, in order, no pagination header bleeding into the
  stream. **Failed, 2026-08-27** — the "The SAS System …" page-break banner
  bled into the stream roughly every 58 lines. Root cause: `isNoiseLine`
  (`src/backend/logFilter.ts`) doesn't exclude `title`-typed log lines, and
  `PAGESIZE=MAX` still isn't sent at session creation — both already named as
  an open gap in `logFilter.ts`'s own doc comment (Finding 63) but never
  picked up as a fix. Tracked in Phase 3's **3f** slice.
- [x] **(live) Busy session refuses a second submission** — start the long run
  below, then try **Run File** again.
  **Expect:** refused with an “already running” message.
- [x] **(live) Cancel, both ways** — run:

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

## 7. Tracebacks — phase 3c-ii

- [x] **(live) Wrapper frames are dropped, yours are kept** — run:

  ```python
  def inner():
      raise ValueError("boom")

  def outer():
      inner()

  outer()
  ```

  **Expect:** a traceback showing `outer` then `inner` and `ValueError: boom`.
  The harness's leading `<stdin>` wrapper frames at the top are gone.
- [x] **(live) Deep / recursive stacks survive** — run a bare recursion, no
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
- [x] **(live) `ModuleNotFoundError` points at Show Environment** — run
  `import polars` (or any absent package).
  **Expect:** a `ModuleNotFoundError` traceback whose diagnostic message (the
  line after "Finished with an error." in the output channel) has one
  sentence appended: `Run "Python on Viya: Show Environment" to see what is
  installed on this connection.` The structured traceback itself (Result
  panel, once 4d wires it) keeps Python's own text unchanged.
  **Implemented in phase 4c** (`src/backend/tracebackDiagnostics.ts`'s
  `withModuleNotFoundGuidance`), unit-covered, and **verified live
  2026-09-01** against `verde` with a branch `.vsix` — the appended sentence
  appears on the diagnostic exactly as above.
- [x] **(live) A failed run lands in the Problems panel — phase 4d** — run a
  file whose last line is `c = 1 / 0`.
  **Expect:** after "Finished with an error.", the **Problems** panel
  (View → Problems) shows exactly one entry for this file — `Error`, source
  "Python on Viya", its message the same `ZeroDivisionError: division by
  zero` line the output channel shows — positioned on the `1 / 0` line.
  Expanding it walks the rest of the call stack (`relatedInformation`).
  Re-run the file with the error fixed → the Problems entry clears at the
  **start** of the run. Run Selection starting partway down the file → the
  entry still lands on the true editor line (`lineOffset` is added). A
  SAS-side failure with no Python traceback (e.g. `PROC PYTHON` not licensed)
  produces **no** Problems entry — only the output-channel message.
  Implemented in phase 4d (`src/run/diagnostics.ts`); **verified live
  2026-09-02** against `verde` with a branch `.vsix` — the entry lands on
  the `1 / 0` line, clears on a clean re-run, and follows the selection's
  `lineOffset`.

## 8. Rich output: matplotlib and pandas — phases 3c-i, 3d-ii

Capture is a before/after diff of the session's working directory
([ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)) —
your script must actually write a `.png` or `.html` file; there is no implicit
`savefig`. Output lands in the Result panel, a single CSP-locked webview
([ADR-0021](../adr/0021-result-panel-webview.md)).

- [x] **(live) matplotlib figure renders in the panel** — run:

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
- [x] **(live) pandas HTML renders as a real table** — run:

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
- [x] **(live) Multiple figures, ordered and numbered** — a loop writing
  `fig_0.png`, `fig_1.png`, `fig_2.png`.
  **Expect:** all three in the panel, in filename order, after the text output,
  numbered.
- [x] **(live) Panel is a singleton** — run another rich output with the panel
  already open.
  **Expect:** the same panel is reused, never a second one — meaning its
  content is **replaced**, not appended to. Confirmed 2026-08-27: re-running a
  rich output clears the existing panel and writes the new one in its place;
  this is the intended behavior, not a bug.
- [x] **(live) Reveal policy** — run a text-only script; then one producing an
  image; then a run that only fails.
  **Expect:** text-only (fully visible in the output channel) does **not** pop
  the panel; an image / HTML / structured traceback does; an outcome-only or
  failure-only run never opens it.
- [x] **(live) Re-reveal for a later run** — leave the panel open but click back
  into the editor so it is unfocused; run another matplotlib script.
  **Expect:** the panel comes back to the front — not only for the run that
  first created it. _(Regression: this was a fixed bug.)_
- [x] **(live) Oversize output is skipped, not fatal** — write a `.png` bigger
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
- [x] **(live) Cancelled run captures nothing** — a script that writes a figure
  then `time.sleep(60)`; cancel it.
  **Expect:** no image captured — the after-snapshot is skipped on a cancelled
  outcome. Confirmed 2026-08-27. **Follow-up raised, not a failure of this
  item:** by design (ADR-0019), a cancelled run never reads back *or deletes*
  whatever partial file was written before cancellation, so it can be
  orphaned in the session's working directory. Tracked as a documentation
  item in Phase 3's **3f** slice — ADR-0019 should say this explicitly rather
  than leaving it implicit.
- [x] **(known gap) Reload loses the panel content** — with the panel populated,
  reload the window.
  **Expect:** the content is gone. No `WebviewPanelSerializer` yet — same as the
  output channel losing scrollback.
- [x] **(live) Accessibility and theming** — tab through the panel; switch VS
  Code between light, dark, and a high-contrast theme.
  **Expect:** image alt text; the table is a navigable table; a traceback is a
  heading, a message, and a genuine ordered list of frames. Legible in every
  theme; loads nothing from the network (CSP-locked).
- [x] **(live) Traceback frames jump to the editor — phase 4d** — run the
  `outer()`/`inner()` script from §7 and let it raise, so the Result panel
  shows its structured traceback.
  **Expect:** each frame from your own file (`<string>`) is underlined and
  focusable — click it, or Tab to it and press Enter/Space, and the editor
  reveals that line (adding the `lineOffset` for a Run Selection). A frame
  with an absolute library path is plain text, not interactive. No CSP
  change — the panel still loads nothing from the network. **Verified live
  2026-09-02** against `verde` with a branch `.vsix` — clicking a `<string>`
  frame reveals it in the editor column (not over the panel); a library
  frame is not clickable.

## 9. Environment and package list — phase 3e

A slow answer that changes rarely — probed on demand, cached per profile in
global state, refreshed explicitly.

- [x] **(live) Show Environment opens the list** — run **Show Environment** (or
  click the second status-bar item, right of the profile).
  **Expect:** a read-only virtual document: interpreter version and path, then
  installed distributions with versions (from `importlib.metadata`, not `pip`).
  Ctrl/Cmd-F searches it; it splits alongside code.
- [x] **(live) Refresh updates an open tab in place** — with the document open,
  run **Refresh Environment Info**.
  **Expect:** it re-probes and the open tab shows the fresh answer (no new tab).
- [x] **(live) Per-profile cache** — Show Environment on profile A; switch to B
  and Show Environment (it probes); switch back to A.
  **Expect:** A's list returns instantly from cache — keyed on profile id.
- [x] **(live) Cache persists across reload** — reload the window, then Show
  Environment.
  **Expect:** still instant — the cache is `globalState`. A fresh window with a
  cached answer should not connect just to render it.
- [x] **(live) Probing has no side effects on your namespace** — run selection
  `z = 1`; force a **Show Environment** refresh; run selection `print(z)`.
  **Expect:** `1` — the probe neither restarts the interpreter nor leaves
  `sys` / `json` / `importlib` bound in your namespace.
- [x] **(live) Shares the serial contract** — trigger **Show Environment** while
  a run is in flight.
  **Expect:** refused, as a second run would be — there is just nothing to
  cancel it with.
- [x] **(live) A big list renders whole** — on a stock Viya 4 the list can run
  to a few hundred entries (~250+). To actually see this: run **Show
  Environment** against a profile with `numpy`/`pandas`/`matplotlib`/`scipy`
  installed (each pulls in a long dependency chain) — `verde` measured 259
  packages during Phase 3e's own live probe, a realistic stand-in for "a few
  hundred."
  **Expect:** the whole list renders; a distribution with broken `METADATA` is
  skipped rather than blanking or crashing the probe. *(Not run 2026-08-27 —
  the previous wording gave no concrete way to reach "a big list"; use the
  profile/package guidance above.)*

## 10. Trust, enablement and the rest

- [x] **Untrusted workspace posture** — set the folder Restricted via
  **Workspaces: Manage Workspace Trust**.
  **Expect:** editing, syntax, and profile add/edit/delete still work;
  **Connect** and **Run File** are refused with a pointer to Manage Workspace
  Trust; `pythonOnViya.connectionProfiles` and `pythonOnViya.defaultProfile`
  show as restricted in Settings.
- [x] **Command enablement tracks state** — watch the palette across connect /
  disconnect / a run in flight.
  **Expect:** _Connect_ disappears once connected; _Disconnect_ only while
  connected; _Cancel_ only while a run is in flight. Confirmed for this
  ordinary connect/disconnect cycle. **Not covered by this item:** the
  sign-out/idle-reap/reload edge cases where Connect gets stuck hidden even
  though nothing is actually connected — see §3/§4 above and Phase 3's **3f**
  slice.
- [x] **(live) Sign out while connected** — with a live session, run **Sign
  Out**.
  **Expect:** the session is dropped; the next run re-authenticates cleanly.
  **Failed, 2026-08-27** — same defect as §3's Sign Out item: re-authentication
  never happens automatically. Tracked in Phase 3's **3f** slice; don't
  double-count against §3.
- [x] **Failures are diagnosable** — on any error path, open **Show Log**.
  **Expect:** it names the request, the deployment's own wording, a status code,
  and a correlation id. **Failed, 2026-08-27** — Python-level errors (a
  traceback) are diagnosable, but most *extension*-level failures ("could not
  be sent to SAS Viya…") produce nothing in the log at all. Root cause: three
  failure paths in `src/run/commands.ts` never call `log.*` before showing
  that message. Tracked in Phase 3's **3f** slice.

## 11. Regression spot-checks

Each of these was a real defect caught in review. Quick to confirm now that you
are set up.

- [x] **(live) Runs actually produce output** — any successful **Run File**
  shows its stdout.
  **Expect:** output appears. A run that reports success but shows nothing has
  regressed the `infile=` step-close fix (finding 70): the job can report
  `completed` with nothing flushed unless the step is closed.
- [x] **(live) Cancel is scoped to what it actually started, not to "the active
  profile"** — a *separate VS Code window* cannot reach another window's
  in-flight run at all (each window is its own extension host with no shared
  `currentRun`/`currentReset` state), so that repro can never exercise this
  item. Instead: connect on profile A in **one window**, start a 60-second
  run, then use **Select Run Target** to switch that **same window** to
  profile B mid-run, and invoke **Cancel**.
  **Expect:** A's run keeps going — Cancel acts on the backend it actually
  started the run against, not on whatever profile is active now. *(The
  2026-08-27 pass used the two-window repro this item used to describe, which
  can't test the real invariant — code-traced as correct
  (`src/run/commands.ts`'s `currentRun`/`currentReset` tracking, from PR #63),
  but re-run with the same-window repro above before ticking this box.)*
- [x] **(live) Backend re-connects after a reset** — run **Reset Python State**,
  then immediately **Run File** on the same profile.
  **Expect:** the run works — the per-profile backend cache re-calls the
  idempotent `connect()` before handing a cached backend back out.
- [x] **(live) Panel re-reveal and probe resilience** — confirmed in §8
  (re-reveal) and §9 (broken-metadata tolerance); tick here once both hold.

---

## Keeping this current

This page is meant to be re-run every phase, so it has to grow with the product.

- **Sections 0–1 and 10–11 are phase-agnostic.** Pre-flight, activation, trust,
  enablement and the regression spot-checks apply to every build. The regression
  section grows by one bullet each time review catches a defect worth
  re-confirming by hand.
- **Sections 2–9 map to phases 1–3.** When a phase closes, add a section (or
  extend one) for its user-visible behaviour, and cite the slice and ADR in the
  heading the same way the existing sections do. Phase 4's traceback
  editor-position mapping, for instance, turns the `ModuleNotFoundError`
  **(known gap)** row in §7 into a real assertion.
- **Retire a gap when it closes.** A **(known gap)** row is a promise to update
  it, not a permanent excuse. When the behaviour lands, rewrite the row as a
  normal **Expect**.
- **Re-run the whole thing before a release** — it is [release
  checklist](../release-checklist.md) D6, and “publishing green is not the same
  as working”.

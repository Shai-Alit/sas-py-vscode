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

- [ ] **Build the VSIX** — `npm run package` from the repo root.
  **Expect:** `vsce package` writes `dist/python-on-viya.vsix` and
  `check:package` passes (the manifest lists ~10 entries, LICENSE and NOTICE
  included).
- [ ] **Install it into a real VS Code** — Extensions view → **⋯** → **Install
  from VSIX…**, or `code --install-extension dist/python-on-viya.vsix`. Reload.
  **Expect:** “Python on Viya” shows as installed; no activation error.
- [ ] **Install `ms-python.python`** in the same window.
  **Expect:** needed for completion/hover (editing intelligence is delegated)
  and for the editor run-button check in §5.
- [ ] **Open a trusted folder with a `.py` file.** Have a Viya 4 deployment
  reachable and know one compute context whose SAS server has the Python
  interpreter configured.
- [ ] **Open the log** — run **Python on Viya: Show Log** and dock it.
  **Expect:** a clean “Python on Viya activated.” line.

## 1. Activation and logging

- [ ] **Activates on startup**, no command needed. Reload and wait.
  **Expect:** activation on `onStartupFinished`; nothing alarming in the log.
- [ ] **The palette only offers what is valid now.** Type “Python on Viya”.
  **Expect:** with no profile and a Local target you see _Add Connection
  Profile_, _Import Connection Profiles…_, _Select Run Target_, _Show Log_ —
  and **not** _Connect_, _Disconnect_, _Cancel_. Unavailable commands are
  omitted, not greyed.

## 2. Connection profiles — phase 1a

The profile _model_ is validated whether you use the commands or hand-edit
`settings.json`. Secrets never live in settings.

- [ ] **Add a profile** — a name, an `https://…` endpoint, context and client id
  left empty.
  **Expect:** “Added connection profile …” toast; the status bar shows the name.
- [ ] **Endpoint validation rejects the dangerous shapes** — try
  `http://viya.example.com` (non-loopback http) and `https://user:pw@host`.
  **Expect:** both refused with a specific reason (token readable over http;
  credentials do not belong in a settings file).
- [ ] **Settings shape is right** — inspect `pythonOnViya.connectionProfiles`.
  **Expect:** keyed by name, each entry carrying a `version` and a generated
  `id`, and **no** client secret anywhere.
- [ ] **Hand-editing is picked up and re-validated** — change a profile's
  endpoint in `settings.json`, then break another (drop the scheme).
  **Expect:** the valid edit takes effect; the broken one is ignored with a log
  line naming which and why, not a whole-setting failure.
- [ ] **`defaultProfile` vs Switch** — set `pythonOnViya.defaultProfile` to a
  name and reload; then **Switch Connection Profile** to another.
  **Expect:** a fresh window starts on `defaultProfile`; switching overrides it
  for this window only and does not rewrite the setting.
- [ ] **Edit and Delete** — **Edit Connection Profile** (change endpoint, leave
  the secret prompt blank); **Delete Connection Profile**.
  **Expect:** edit updates in place and keeps the stored secret; delete removes
  the entry and drops its secret from secret storage.
- [ ] **(slow) One-time import from the SAS extension** — only if that extension
  is installed with profiles: **Import Connection Profiles from the SAS
  Extension**.
  **Expect:** Viya profiles copied once; non-Viya kinds skipped.

## 3. Sign in — phase 1b

- [ ] **(live) OAuth2 + PKCE round trip** — run **Sign In**.
  **Expect:** the system browser opens SASLogon; you land back in VS Code. On a
  stock Viya 4 that is the paste-box arm; the URI-handler arm only fires with an
  admin-registered client. Signing in also opens a compute session.
- [ ] **(live) Empty client id uses the built-in client** — profile with
  `clientId` empty.
  **Expect:** the built-in `vscode` client on Viya 4 2022.11+. On 3.5 / older 4
  you are told, in those words, to supply an id and secret. _(Viya 3.5 is
  unverified — treat as untested.)_
- [ ] **Sign out** — run **Sign Out**, then trigger a run.
  **Expect:** you are taken back through authentication.
- [ ] **(live) (slow) Proxy / internal CA** — only if applicable: sign in as
  normal.
  **Expect:** it completes; proxy and OS/internal certificate trust are
  inherited from the extension host.

## 4. Connect and the compute session — phase 2a

One session per folder, per profile ([ADR-0012](../adr/0012-compute-session-lifetime-and-storage.md)).
Reload reconnects; it does not restart.

- [ ] **(live) Cold-start Connect** — signed out, run **Connect to SAS Viya**.
  **Expect:** it signs you in first, shows a progress notification while the
  session opens, then an info message naming the profile.
- [ ] **(live) Context picker and write-back** — profile with no `context`: the
  first connect lists contexts. Dismiss it once; connect again and pick a
  working one.
  **Expect:** dismiss → connect cancels, nothing written. After a session
  actually starts, `context` is written back into the profile in
  `settings.json`.
- [ ] **(live) Reload reconnects with state intact** — run selection `k = 99`
  (see §6). Reload the window. Run selection `print(k)`.
  **Expect:** `99` — you re-attached to the same interpreter.
- [ ] **(live) Disconnect ends it now** — run **Disconnect from SAS Viya**, then
  run selection `print(k)` again.
  **Expect:** a fresh interpreter opens and `k` is gone (`NameError`).
- [ ] **(live) Shared vs independent sessions** — open a second window on the
  same folder; set a var in one, read it in the other. Then switch to a second
  profile and connect.
  **Expect:** same folder + same profile → one shared session; a different
  profile → its own, the first undisturbed.
- [ ] **(live) (slow) Idle reap** — connect, leave idle past the deployment
  timeout (15 min default).
  **Expect:** the next connect silently opens a fresh interpreter — the stale
  session id is a hint, not a fact, and you are not prompted.
- [ ] **(live) Error surfaces read sensibly** — reach what you can: Viya target
  with no active profile; a context you can see but cannot launch; Cancel
  mid-connect.
  **Expect:** “Select a … profile”; a two-readings message; **silence** after
  Cancel. **Show Log** carries status codes and correlation ids.

## 5. Run target: Local vs Viya — phase 3d-i

The target governs _where_ our commands appear, never what they do. An
unconfigured workspace is Local and contributes nothing to the editor
([ADR-0011](../adr/0011-choosing-where-python-runs.md),
[ADR-0020](../adr/0020-run-target-defaults-to-local.md)).

- [ ] **Fresh workspace is Local and invisible in the editor** — new folder, a
  `.py` file, nothing configured.
  **Expect:** the status bar names the target **Local**; there is **no** run
  icon of ours in the editor title bar, and our _Run File_ / _Run Selection_
  are absent from the editor context menu.
- [ ] **Select Run Target sets target + profile together** — **Select Run
  Target** → a Viya profile.
  **Expect:** one gesture sets both. Choosing **Local** again removes our editor
  contributions.
- [ ] **Viya target with no profile** — switch the target to Viya before picking
  a profile, then try to run.
  **Expect:** a “no profile selected” readiness state — you are told to pick
  one, not dropped back to Local.
- [ ] **Editor button merges with `ms-python`, not doubles** — target = Viya,
  folder trusted, `ms-python.python` installed, a `.py` file open.
  **Expect:** one play button with a dropdown chevron, not two side by side.
  Note which command the tooltip names as primary, and that it does not flip
  around as you use the dropdown. **(known gap)** no keybinding ships — palette
  / button / menu only.
- [ ] **Context-menu entries gated correctly** — right-click with Viya +
  trusted, then Local, then untrusted.
  **Expect:** our _Run File_ / _Run Selection_ appear only under Viya + trusted.
- [ ] **Flipping the target changes placement only** — toggle Local ↔ Viya,
  invoking _Run File_ from the palette each time.
  **Expect:** the command always means the same thing; only whether it also
  appears in the editor changes.

## 6. Running Python: text output — phases 3a, 3b

- [ ] **(live) Hello world streams clean** — a file that is
  `print("hello from viya")` → **Run File**.
  **Expect:** a run header, then `hello from viya` as plain stdout, then a
  “Finished” line. No SAS NOTEs, no page-break banners, no `>>>` markers.
- [ ] **(live) Submission fidelity — run the whole corpus.** Open each file under
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
  silent-failure cases the corpus exists for.
- [ ] **(live) Run File starts a fresh namespace each time** — **Run File** a
  file that is just `a = 41`; then **Run File** a file that is just `print(a)`.
  **Expect:** `NameError` — every _Run File_ runs with `freshNamespace: true`.
- [ ] **(live) Run Selection builds on state like a cell** — select `b = 41` →
  **Run Selection**; then select `print(b + 1)` → **Run Selection**.
  **Expect:** `42` — a selection runs against the live namespace
  (`freshNamespace: false`).
- [ ] **(live) Reset Python State really restarts the interpreter** — after the
  previous item, run **Reset Python State**, then select `print(b)` → **Run
  Selection**.
  **Expect:** `NameError`.
- [ ] **(live) Failure is detected, not swallowed** — run a file whose top level
  raises (`raise RuntimeError("nope")`).
  **Expect:** reported as failed, not “Finished”; the error text is in the log.
- [ ] **(live) Large output stays clean** — run `for i in range(5000): print(i)`.
  **Expect:** all 5000 lines, in order, no pagination header bleeding into the
  stream.
- [ ] **(live) Busy session refuses a second submission** — start the long run
  below, then try **Run File** again.
  **Expect:** refused with an “already running” message.
- [ ] **(live) Cancel, both ways** — run:

  ```python
  import time
  print("start")
  time.sleep(60)
  print("done")
  ```

  Cancel from the progress notification's **Cancel** button; repeat and cancel
  via the **Cancel** command in the palette.
  **Expect:** both stop the run; `done` never prints. The notification really
  does show a Cancel button (Notification-location progress, not Window).

## 7. Tracebacks — phase 3c-ii

- [ ] **(live) Wrapper frames are dropped, yours are kept** — run:

  ```python
  def inner():
      raise ValueError("boom")

  def outer():
      inner()

  outer()
  ```

  **Expect:** a traceback showing `outer` then `inner` and `ValueError: boom`.
  The harness's leading `<stdin>` wrapper frames at the top are gone.
- [ ] **(live) Deep / recursive stacks survive** — a function that recurses to
  `RecursionError`.
  **Expect:** the repeated frames are all there — only the _leading_ contiguous
  run of harness frames is removed.
- [ ] **(live) (known gap) `ModuleNotFoundError` shows as an ordinary
  traceback** — run `import polars` (or any absent package).
  **Expect:** a plain `ModuleNotFoundError` traceback. It is not yet
  cross-linked to Show Environment — that is Phase 4.

## 8. Rich output: matplotlib and pandas — phases 3c-i, 3d-ii

Capture is a before/after diff of the session's working directory
([ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)) —
your script must actually write a `.png` or `.html` file; there is no implicit
`savefig`. Output lands in the Result panel, a single CSP-locked webview
([ADR-0021](../adr/0021-result-panel-webview.md)).

- [ ] **(live) matplotlib figure renders in the panel** — run:

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
- [ ] **(live) pandas HTML renders as a real table** — run:

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
- [ ] **(live) Multiple figures, ordered and numbered** — a loop writing
  `fig_0.png`, `fig_1.png`, `fig_2.png`.
  **Expect:** all three in the panel, in filename order, after the text output,
  numbered.
- [ ] **(live) Panel is a singleton** — run another rich output with the panel
  already open.
  **Expect:** the same panel is reused, never a second one.
- [ ] **(live) Reveal policy** — run a text-only script; then one producing an
  image; then a run that only fails.
  **Expect:** text-only (fully visible in the output channel) does **not** pop
  the panel; an image / HTML / structured traceback does; an outcome-only or
  failure-only run never opens it.
- [ ] **(live) Re-reveal for a later run** — leave the panel open but click back
  into the editor so it is unfocused; run another matplotlib script.
  **Expect:** the panel comes back to the front — not only for the run that
  first created it. _(Regression: this was a fixed bug.)_
- [ ] **(live) Oversize output is skipped, not fatal** — write a `.png` bigger
  than 10 MiB.
  **Expect:** a “could not retrieve rich output file …” note instead of a
  failed run.
- [ ] **(live) Cancelled run captures nothing** — a script that writes a figure
  then `time.sleep(60)`; cancel it.
  **Expect:** no image captured — the after-snapshot is skipped on a cancelled
  outcome.
- [ ] **(known gap) Reload loses the panel content** — with the panel populated,
  reload the window.
  **Expect:** the content is gone. No `WebviewPanelSerializer` yet — same as the
  output channel losing scrollback.
- [ ] **(live) Accessibility and theming** — tab through the panel; switch VS
  Code between light, dark, and a high-contrast theme.
  **Expect:** image alt text; the table is a navigable table; a traceback is a
  heading, a message, and a genuine ordered list of frames. Legible in every
  theme; loads nothing from the network (CSP-locked).

## 9. Environment and package list — phase 3e

A slow answer that changes rarely — probed on demand, cached per profile in
global state, refreshed explicitly.

- [ ] **(live) Show Environment opens the list** — run **Show Environment** (or
  click the second status-bar item, right of the profile).
  **Expect:** a read-only virtual document: interpreter version and path, then
  installed distributions with versions (from `importlib.metadata`, not `pip`).
  Ctrl/Cmd-F searches it; it splits alongside code.
- [ ] **(live) Refresh updates an open tab in place** — with the document open,
  run **Refresh Environment Info**.
  **Expect:** it re-probes and the open tab shows the fresh answer (no new tab).
- [ ] **(live) Per-profile cache** — Show Environment on profile A; switch to B
  and Show Environment (it probes); switch back to A.
  **Expect:** A's list returns instantly from cache — keyed on profile id.
- [ ] **(live) Cache persists across reload** — reload the window, then Show
  Environment.
  **Expect:** still instant — the cache is `globalState`. A fresh window with a
  cached answer should not connect just to render it.
- [ ] **(live) Probing has no side effects on your namespace** — run selection
  `z = 1`; force a **Show Environment** refresh; run selection `print(z)`.
  **Expect:** `1` — the probe neither restarts the interpreter nor leaves
  `sys` / `json` / `importlib` bound in your namespace.
- [ ] **(live) Shares the serial contract** — trigger **Show Environment** while
  a run is in flight.
  **Expect:** refused, as a second run would be — there is just nothing to
  cancel it with.
- [ ] **(live) A big list renders whole** — on a stock Viya 4 the list can run
  to a few hundred entries (~250+).
  **Expect:** the whole list renders; a distribution with broken `METADATA` is
  skipped rather than blanking or crashing the probe.

## 10. Trust, enablement and the rest

- [ ] **Untrusted workspace posture** — set the folder Restricted via
  **Workspaces: Manage Workspace Trust**.
  **Expect:** editing, syntax, and profile add/edit/delete still work;
  **Connect** and **Run File** are refused with a pointer to Manage Workspace
  Trust; `pythonOnViya.connectionProfiles` and `pythonOnViya.defaultProfile`
  show as restricted in Settings.
- [ ] **Command enablement tracks state** — watch the palette across connect /
  disconnect / a run in flight.
  **Expect:** _Connect_ disappears once connected; _Disconnect_ only while
  connected; _Cancel_ only while a run is in flight.
- [ ] **(live) Sign out while connected** — with a live session, run **Sign
  Out**.
  **Expect:** the session is dropped; the next run re-authenticates cleanly.
- [ ] **Failures are diagnosable** — on any error path, open **Show Log**.
  **Expect:** it names the request, the deployment's own wording, a status code,
  and a correlation id.

## 11. Regression spot-checks

Each of these was a real defect caught in review. Quick to confirm now that you
are set up.

- [ ] **(live) Runs actually produce output** — any successful **Run File**
  shows its stdout.
  **Expect:** output appears. A run that reports success but shows nothing has
  regressed the `infile=` step-close fix (finding 70): the job can report
  `completed` with nothing flushed unless the step is closed.
- [ ] **(live) Cancel is scoped to the active profile** — connect profile A,
  start a 60-second run; in a second window switched to profile B, invoke
  **Cancel**.
  **Expect:** A's run keeps going — Cancel's reset-interrupt fallback only
  reaches the currently active profile's backend.
- [ ] **(live) Backend re-connects after a reset** — run **Reset Python State**,
  then immediately **Run File** on the same profile.
  **Expect:** the run works — the per-profile backend cache re-calls the
  idempotent `connect()` before handing a cached backend back out.
- [ ] **(live) Panel re-reveal and probe resilience** — confirmed in §8
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

<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 10 (Viya environment awareness)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## Local/remote diff and Search environment (phase 10a)

`docs/phases/phase-10.md`'s 10a Runbook entry has the full account: `Show
environment`'s existing plain-text document gains a "Local comparison"
section, reading whichever interpreter `ms-python.python` currently has
active via `@vscode/python-extension` and diffing its installed packages
(PEP 503-normalised) against the Viya profile's own cached probe; a new
`Python on Viya: Search environment` command opens a filterable `QuickPick`
over the same cached package list, additive to the document rather than a
replacement for it.

**Pre-work:** a signed-in Viya profile with a successful `Show environment`
probe already cached (run **Python on Viya: Show environment** once first if
needed), and `ms-python.python` installed with a real local virtual
environment available to select.

- [x] **10.1** **The Local comparison section reports a real three-way diff
  against the active local interpreter** — select a local virtual
  environment (via `ms-python.python`'s interpreter picker) whose installed
  packages differ from the Viya profile's — e.g. `pip install` one package
  locally that is not on Viya, and note one package that's on both sides at
  different versions. Run **Python on Viya: Show environment**. **(live)**
  **Expect:** a "Local comparison" section below the package list, with three
  headed buckets — packages only on the Viya profile, packages only in the
  local environment, and packages at a different version locally than on
  Viya (shown as `remote → local`). A package installed under different
  letter-casing on each side (e.g. `Pillow` locally, `pillow` on Viya, same
  version) must **not** appear in the version-mismatched bucket — PEP 503
  name normalisation should treat the two as the same package.
- [x] **10.2** **The Local comparison section degrades to an honest "unknown"
  message, never an error, when there is no local interpreter to compare
  against** — with no workspace folder open (or no interpreter selected via
  `ms-python.python`'s picker — **Python: Select Interpreter** →
  **Enter interpreter path...** → cancel, or **Clear Workspace Interpreter
  Setting**), run **Python on Viya: Show environment** again. **(live)**
  **Expect:** the document still renders normally end to end — profile,
  interpreter, full package list — with the "Local comparison" section
  showing a plain sentence that the local environment is unknown, not a
  blank section, an exception, or a broken document.
- [x] **10.3** **A local-side hiccup (a stale/deleted interpreter) does not
  take down the rest of the document** — select a local interpreter via
  `ms-python.python`, confirm §10.1's diff renders, then delete or rename
  that interpreter's virtual-environment folder on disk (without reselecting
  a different one) and run **Python on Viya: Show environment** again.
  **(live)** (adversarial review finding, `feat/phase-10a-environment-diff`:
  `readActiveLocalEnvironment` now wraps `getActiveEnvironmentPath`/
  `resolveEnvironment` in their own `try`/`catch` so a local-only failure
  can't propagate out of `provideTextDocumentContent` and blank the whole
  document.)
  **Expect:** the document still renders the profile, interpreter and full
  Viya package list exactly as before — at worst the "Local comparison"
  section falls back to the same "unknown" message as §10.2; the whole
  document must never fail to open or show an error in place of the
  previously-working Viya-side content.
- [x] **10.4** **`Python on Viya: Search environment` opens a filterable
  picker over the cached package list and copies the picked entry to the
  clipboard** — run **Python on Viya: Search environment** for a profile with
  a cached probe. **(live)**
  **Expect:** a `QuickPick` titled "Search Environment — `<profile name>`"
  opens, listing every cached package sorted by name with its version as the
  description; typing part of a package's name filters the list live (VS
  Code's own built-in fuzzy filter, matching on both name and version). Pick
  one entry. **Expect:** a toast reading "Copied `<name>`==`<version>` to the
  clipboard.", and pasting anywhere confirms the clipboard actually holds
  `name==version`.
- [x] **10.5** **`Search environment` never force-probes** — pick a profile
  whose cached probe is now stale (e.g. a package was installed on the Viya
  side since the last `Show environment`/`Refresh environment`), and run
  **Python on Viya: Search environment** without running **Refresh
  environment** first. **(live)**
  **Expect:** the picker shows the same (now stale) cached list rather than
  triggering a fresh probe — matching `Show environment`'s own cache-first
  default. Run **Python on Viya: Refresh environment**, then **Search
  environment** again: **Expect** the newly installed package now appears.

## Pylance stub reflection (phase 10b)

`docs/phases/phase-10.md`'s 10b Runbook entry has the full account, and its
Probe findings section (Findings 10.1/10.2) has the two mechanical questions
this session settled via the `pyright` CLI rather than a live VS Code window —
this is the first hands-on confirmation of that behaviour against the real
Pylance extension rather than its open-source engine alone. A fresh probe (via
**Show environment** or **Refresh environment info**) writes generated
catch-all stubs to `.pythonOnViya/typings/` for whatever the Local comparison
section calls "only on this Viya profile", and points
`python.analysis.stubPath` at that folder.

**Pre-work:** a workspace folder open (not a single loose file — `stubPath`
needs one), the Python extension **and** Pylance both installed and active,
and a Viya profile connected whose package set includes something not
installed in your local interpreter (or `pip uninstall` one locally that is
on Viya, to manufacture a `remoteOnly` entry).

**Verifying without another reload:** once a test below has already produced
one reload, later tests can often be checked without triggering a second one
— inspect `.pythonOnViya/typings/` directly (does the expected package
subfolder exist, and does its `__init__.pyi` have real content?) and
`.vscode/settings.json` (does `python.analysis.stubPath` point at it?) rather
than relying only on what the editor's squiggles show. This also avoids the
false signal §10.8's first attempt hit: a package already stubbed by an
earlier test changes its own diagnostic the moment its local install
disappears, with no refresh involved at all — always confirm you're testing
against a package this workspace has never stubbed before, by checking it has
no existing subfolder under `.pythonOnViya/typings/` first.

- [x] **10.6** **A `remoteOnly` package's import stops being flagged as fully
  missing, after a reload** — in a `.py` file in the open workspace, write
  `import <a Viya-only package's name>`. **(live)** **Expect (before any
  refresh in this session):** if this is the first probe ever for this
  profile, no stub exists yet, so the import may still show
  `reportMissingImports`. Run **Python on Viya: Refresh environment info**.
  **Expect:** a notification that Pylance stub information was updated and a
  reload is needed, with a **Reload Window** action button on it (added on
  adversarial review, `feat/phase-10b-pylance-stub-reflection` — previously
  prose-only, naming the command but with nothing to click). Click that
  button rather than running the command from the palette this time.
  **Expect:** the window reloads, and the same import now shows no error, or
  at worst a `reportMissingModuleSource` warning ("stub file not found") —
  never `reportMissingImports`. Dismissing the notification without clicking
  the button (or running **Developer: Reload Window** from the palette
  instead) must still work exactly as before — the button is additive, not a
  replacement for the existing path.
- [x] **10.7** **A package that already resolves locally is never stubbed —
  no regression in real type information** — pick a package installed in
  *both* your local environment and on Viya (e.g. one already in the
  "different version locally than on Viya" bucket, or install the same
  package locally that Viya has). **(live)** **Expect:** after a refresh and
  reload, that package's own real completions/hover-type information in the
  editor are unchanged from before this feature existed — no `Any`-typed
  catch-all behaviour, and no new file for it under
  `.pythonOnViya/typings/`.
- [x] **10.8** **A window reload is genuinely required — a stub-tree change
  is not picked up live** — with the workspace already open and Pylance
  already analysing, run **Refresh environment info** for a profile whose
  remote package set changed since the last probe (add or remove one on the
  Viya side, or simulate by `pip install`/`pip uninstall`-ing locally to
  change what counts as `remoteOnly`). **(live)** **Expect:** the editor's
  diagnostics for an affected import do **not** change until you actually
  reload the window (or run **Python: Restart Language Server**) —
  confirming Finding 10.1 holds for the real Pylance extension, not only the
  `pyright` CLI this session used to establish it.
  **(9/15/2026) failed, partially.** First attempt used `saspy` — invalid
  signal, discarded: `saspy` already had a generated stub on disk from an
  earlier test today, so Pylance's downgrade to
  `reportMissingModuleSource` happened the instant `pip uninstall saspy` ran,
  before **Refresh environment info** was even invoked — nothing to do with
  this feature's own sync. Re-run with `babel` (never stubbed in this
  workspace before): uninstalling it locally correctly produced
  `reportMissingImports` immediately, and running **Refresh environment
  info** correctly left that diagnostic unchanged (first half of Finding 10.1
  holds). But after accepting the "reload the window" notice and letting the
  window fully reload, the `babel` import still showed
  `reportMissingImports` — the diagnostic never downgraded. Root cause not
  investigated this session (Sean's own call — see `phase-10.md`'s Runbook,
  "Manual test session, 2026-09-15" entry, for the full account and the
  separate, standing objection to the reload cost itself).
  **Re-run same day, after the "Restart Language Server" design change
  landed, using `requests` (never stubbed in this workspace before):**
  uninstalling it locally produced `reportMissingImports` immediately;
  **Refresh environment info** correctly left that diagnostic unchanged
  before either button was clicked (first half of Finding 10.1 re-confirmed).
  The notice now reads "Updated the Pylance stub information for this
  profile. Try restarting the Python language server first — if diagnostics
  still don't reflect it, reload the window." with two buttons, **Restart
  Language Server** (primary/blue) and **Reload Window** (secondary). Clicked
  **Restart Language Server** — took roughly 5–10 seconds. The `requests`
  diagnostic then read `reportMissingModuleSource` — the expected downgrade.
  Running **Reload Window** afterward as well made no further difference (
  still `reportMissingModuleSource`). **This directly contradicts the
  `babel` result above** — same shape of test, same session, only the
  package and the remedy differ (restart-language-server now available,
  where `babel`'s run only had a full reload). Why `babel` didn't downgrade
  under a full reload while `requests` did downgrade under a language-server
  restart is not established — not investigated further this session, per
  the same standing direction not to chase root cause without being asked.
  Recording both results side by side rather than treating this as
  "confirmed fixed."
- [x] **10.9** **An already-customised `python.analysis.stubPath` is left
  untouched, not overwritten** — before connecting, add
  `"python.analysis.stubPath": "./my-own-stubs"` to the workspace's
  `.vscode/settings.json` yourself. Run **Refresh environment info**.
  **(live)** **Expect:** `.vscode/settings.json`'s `stubPath` value is
  unchanged after the refresh (still `./my-own-stubs`); a notification and a
  line in the **Python on Viya** output log both name the conflict (added on
  adversarial review, `feat/phase-10b-pylance-stub-reflection` — the log line
  alone left the user with no visible reason nothing happened);
  `.pythonOnViya/typings/` may still be written to disk, but nothing points
  Pylance at it. Remove the custom setting afterwards to restore the earlier
  tests' behaviour.
  **(9/15/2026) first attempt failed** — nothing reported in the output log;
  root cause not investigated. **Re-run same day, passed**: notification read
  exactly `Skipped Pylance stub generation: python.analysis.stubPath is
  already set to "./my-own-stubs" in this workspace.`; output log carried a
  matching `[warning]`-level line at 21:04:54. The working difference from
  the first attempt was not established (the earlier attempt's own output
  channel/log-level state was not captured) — noted so a future all-green
  run of this suite doesn't read as "confirmed fixed" when it may just be
  "not reproduced."
- [x] **10.10** **A stale stub is pruned once its package stops being
  `remoteOnly`** — after §10.6 has generated a stub for some package name,
  `pip install` that same package locally (or otherwise make it resolve
  locally), then run **Refresh environment info** again. **(live)** **Expect:**
  that package's own subfolder under `.pythonOnViya/typings/` is deleted —
  inspect the folder directly, or confirm after a reload that the import now
  shows your local install's own real type information rather than the
  generic catch-all.
  **(9/15/2026) passed** — used `babel` (already stubbed from §10.8's
  `.pythonOnViya/typings/babel/` entry). Confirmed present beforehand, ran
  `pip install babel` locally, ran **Refresh environment info**: the
  `babel/` subfolder was deleted. Checked via direct folder inspection only,
  not the reload-based alternate check, given §10.8's open finding about
  reloads not reliably clearing diagnostics.
- [x] **10.11** **No workspace folder open degrades quietly** — open a single
  `.py` file with **File: Open File** (not a folder), connect a Viya profile,
  and run **Show environment**. **(live)** **Expect:** the environment
  document itself renders exactly as before (10.1–10.5 unaffected); no error
  is shown to the user for the stub sync specifically, though the **Python on
  Viya** log may note there was no workspace to write stubs into.
  **(9/15/2026) passed** — used **File → Close Folder** then **File → Open
  File...** to get a genuine no-folder state (plain **File: Open File** alone
  does not close an already-open folder). Document rendered normally with no
  errors, checked at both **Info** and **Error** log levels; no log line
  appeared either time, which the "Expect" already allows for since that line
  is optional ("may note"), not required. Also tried running the open file
  with no workspace open (not part of this test's own steps) — worked with
  no errors.
- [x] **10.12** **A generated stub never shadows the workspace's own source**
  — adversarial review, `feat/phase-10b-pylance-stub-reflection`: create a
  folder (or a `.py` file) at the workspace root whose name matches a
  `remoteOnly` package's own top-level import name — e.g. if `pyyaml` is
  `remoteOnly` and stubs to `yaml`, create an empty `yaml/` folder (with an
  `__init__.py`) at the workspace root before running **Refresh environment
  info**. **(live)** **Expect:** `.pythonOnViya/typings/` has no `yaml/`
  entry after the refresh — inspect the folder directly — and Pylance's
  diagnostics for the workspace's own `yaml/` module are unaffected by this
  feature (no `Any`-typed catch-all behaviour). Remove the fixture folder
  afterwards.
  **(9/15/2026) passed** — used `matplotlib` instead of `yaml`: copied the
  real installed `matplotlib/` package folder to the workspace root and
  emptied its top-level `__init__.py` (a heavier fixture than the test's own
  "empty folder" suggestion, but the same shape — a name the workspace now
  owns at its root). After **Refresh environment info**,
  `.pythonOnViya/typings/matplotlib/` was gone; `import matplotlib` in a
  `.py` file showed no red squiggle and hovered normally (only the ordinary
  "not accessed" unused-import hint, unrelated to this feature). Fixture
  folder still needs deleting.
- [x] **10.13** **A second, unchanged refresh does not repeat the reload
  notice** — after §10.6 or §10.8 has already produced one "reload the
  window" notice for a profile, run **Refresh environment info** again with
  nothing changed on either side. **(live)** (adversarial review,
  `feat/phase-10b-pylance-stub-reflection`: an earlier version advised a
  reload on every non-empty sync regardless of whether anything actually
  changed — `stubGenerator.ts`'s `StubTreeSyncPlan.changed` fixes this.)
  **Expect:** no "reload the window" notification this second time — the
  environment document still refreshes normally, just silently on the stub
  front.
  **(9/15/2026) passed** — ran a second refresh with nothing changed since
  §10.12's own refresh; no reload notice appeared, and the environment
  document still refreshed normally.
- [x] **10.14** **`Search environment` shows the same reload notice
  `Show environment` does, when its own probe changes the stub tree** —
  clear this profile's cache (remove and re-add the profile, or otherwise
  force an unprobed state), then run **Python on Viya: Search environment**
  directly, without running **Show environment** first. **(live)**
  (adversarial review, `feat/phase-10b-pylance-stub-reflection`: a
  cache-miss `Search environment` probes and syncs stubs exactly like `Show
  environment` does, but previously gave no signal that it had.) **Expect:**
  once the picker appears, a "reload the window" notification has also
  appeared (order between the two is not significant) — the same notice
  §10.6 produces, not silence.
  **(9/15/2026) passed** — deleted and re-added the connection profile
  (re-authenticated), ran **Search environment** directly with no prior
  **Show environment**/**Refresh**. The routine "checking the environment"
  progress indicator appeared, then the picker opened with a freshly-probed
  package list, and the "reload the window" notification also appeared
  alongside it.

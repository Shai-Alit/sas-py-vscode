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

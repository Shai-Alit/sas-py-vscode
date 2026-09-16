# Phase 10 — Viya environment awareness

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 10 — Viya environment awareness

**Scoped 2026-09-04**, from the same separate clone (`sas-py-vscode-cowork`)
Phases 6–9 were scoped from, kept apart from whatever the primary working
copy has in flight for the same reason as those four passes — branched from
`main` at `95e4c73` (Phase 9's own scoping commit, PR #115, already in this
history). Technical grounding came from a codebase survey of this repo's
existing Stage-2 probe and its consumers (`src/backend/environment.ts`,
`src/run/environmentPanel.ts`/`environmentDocument.ts`/`environmentStore.ts`/
`environmentStatusBar.ts`), `PRODUCTION_PLAN.md` §2.3 and §3.1, and web
research into the Python and Pylance extensions' own current documentation
(cited inline below, all fetched this session). **No live-Viya probe was run
or needed** — see the Probe findings section for why, same reasoning Phase 9
gave for its own scoping pass. No code was written.

**What already exists, and what this phase adds to it.** Phase 3e shipped
the Stage-2 probe (`backend/environment.ts`): a fixed, self-cleaning Python
program that writes `sys.version`, `sys.executable`, and every installed
distribution's `(name, version)` pair (via `importlib.metadata`, never
`pip` — Viya need not have it) to a file in the session's working directory,
parsed back by `parseEnvironmentProbeFile`. `environmentStore.ts` caches the
result per profile in `globalState`, with no automatic expiry — "a slow
answer that changes rarely," refreshed only on request. `environmentPanel.ts`
renders it as a read-only plain-text virtual document (`Python on Viya: Show
environment`), and `environmentStatusBar.ts` gives it a status-bar entry.
This phase does not touch the probe itself — the data it needs already
exists — and instead makes that data more useful in two independent ways
`PRODUCTION_PLAN.md`'s own phase sketch already named: **10a**, a proper
environment view with search/filtering and a diff against the local
environment; **10b**, reflecting the remote package set back to Pylance.
Package *installation* into the compute context stays out of scope — open
decision 8, §6, a governance question deferred on purpose, not reopened
here.

**The two slices are two views of the same underlying problem, not
unrelated features.** `PRODUCTION_PLAN.md` §2.3 states it directly: "the
local environment even resolves imports that the deployment does not have."
10a's diff makes that mismatch visible *as data* (a list of what's on one
side and not the other); 10b makes it stop *producing false editor
diagnostics* in the first place (an import Pylance currently flags as
unresolved, when it is actually present on Viya, or one Pylance resolves
happily against a laptop's own site-packages that will 500 at runtime on
Viya). Both need the same second input this project has never had a reason
to read before: **the local Python environment**, whatever `ms-python.python`
currently has selected, if anything.

**10a — environment view: what "search and filtering" changes about 3e's
own design, and what it doesn't.** 3e's own doc comment on
`environmentPanel.ts` gives a considered reason for a plain-text virtual
document over a webview: editor-native search and split-view, "a package
list is a list, not prose." That reasoning does not disappear here — but a
plain-text document's "search" is `Ctrl+F` highlight-and-scroll, not
filtering: it cannot *hide* the 490 non-matching rows of an 500-package
deployment, and PRODUCTION_PLAN's phrase is "search **and filtering**," not
search alone. This is a real design choice for 10a, not a detail: keep the
plain-text document and accept highlight-only search (cheapest, most
consistent with 3e's own stated rationale, and workable — a `Ctrl+F` on a
sorted, one-package-per-line document already gets a user to `numpy`
quickly); or add a `QuickPick` with its own built-in fuzzy filter-as-you-type
(a transient picker, not a persistent, split-able document — a real loss of
the affordance 3e was chosen for); or move to a small, dependency-free
webview with a `<input>` filter box (closest to the literal ask, but the
exact cost/webview machinery 3e rejected once already, for
`resultPanel.ts`-shaped reasons that have not changed). **Recommend the
`QuickPick` be additive, not a replacement**: a new `Python on Viya: Search
environment` command opens a filterable picker for quick lookups, while
`Show environment` keeps the existing plain-text document (now also carrying
the diff, below) for the "read the whole thing, split it against my code"
case 3e was built for. This avoids re-litigating 3e's own settled choice
while actually answering "filtering."

**10a's diff needs a local package list, which this project has never read
before.** The non-negotiable "no local Python required" constraint (§1) is
about *execution* — it says nothing about *reading* a local interpreter's
already-installed distributions for comparison, which needs no `pip`, no
subprocess, and installs nothing. The documented, no-subprocess path is
`@vscode/python-extension`'s `PythonExtension.api()`: `environments.known`
lists what `ms-python.python` has discovered, `getActiveEnvironmentPath()` /
`resolveEnvironment()` gives the active one's `sysPrefix`
([`microsoft/vscode-python` wiki, "Python Environment APIs"](https://github.com/microsoft/vscode-python/wiki/Python-Environment-APIs),
fetched 2026-09-04). Neither call returns a package list directly; getting
one means reading the `*.dist-info`/`*.egg-info` directories under that
`sysPrefix`'s `site-packages` (Windows: `Lib\site-packages`) with plain
`fs.readdir`, parsing each `METADATA` file's `Name`/`Version` fields — the
Node-side mirror of exactly what `environment.ts`'s own probe does with
`importlib.metadata` on the Viya side, done here without ever invoking a
local Python interpreter. **This makes `ms-python.python` a soft dependency
for 10a's diff specifically** (not for anything else in this phase, and not
for this project generally) — if it is not installed, or no environment is
selected, the honest answer is "local environment unknown," not a guess and
not a hard failure; the diff view degrades to "remote only," same shape as
`RuntimeCapabilities`'s existing `runtime-unavailable`/`backend-failed`
arms degrading gracefully today.

**10b — Pylance reflection: the central technical finding.** Pylance/pyright
resolve an import as one of three outcomes: found with real source, found as
a *stub only* (`reportMissingModuleSource`, a warning, not an error — "a type
stub is found, but the module source file was not found"), or not found at
all (`reportMissingImports`, the false positive this phase exists to kill).
The documented, multiply-attested mechanism for the middle outcome — giving
Pylance type information for a package whose real source is **not installed
in the local interpreter at all** — is `python.analysis.stubPath` (default
`./typings`): a directory of hand- or tool-authored `.pyi` stub packages that
pyright consults ahead of (or instead of) a real install. This is not a
theoretical reading of the settings docs: a maintainer thread on
`microsoft/pyright` walks through exactly this shape — a `typings/rdkit/`
stub tree pointed to by `python.analysis.stubPath`, with `rdkit` itself never
installed locally, resolving happily
([`microsoft/pyright` discussion #5224](https://github.com/microsoft/pyright/discussions/5224),
fetched 2026-09-04) — and the `micropython-stubs` project documents the same
pattern for an interpreter (MicroPython) that is never locally installable
by construction, which is structurally this project's own situation
([`micropython-stubs` docs, "Configuring VSCode, Pylance or Pyright"](https://micropython-stubs.readthedocs.io/en/main/22_vscode.html),
fetched 2026-09-04). **The design this finding points to**: for each package
`environment.ts`'s probe reports, generate a minimal stub —
`typings/<name>/__init__.pyi` containing only a permissive catch-all (a
`def __getattr__(name: str) -> Any: ...` module stub, the standard shape for
"this exists, has this version, but no real type information is available
locally") — and point `python.analysis.stubPath` (workspace-scoped) at a
generated directory. An import Pylance previously flagged as fully missing
becomes, at worst, a suppressible `reportMissingModuleSource`; one that
resolves locally but is *absent* from the diff is 10a's job to surface, not
this one's to silently paper over.

**What 10b's design deliberately does not promise.** The probe's own payload
is `(name, version)` pairs only — never real type information — so a
generated stub can kill the false-missing-import signal and nothing more:
no real completions, no attribute checking, no catching "this function
doesn't take that keyword" the way a genuine `numpy`-stubs install would.
Upgrading a given package's stub from the catch-all shape to real content
(fetching a `types-<name>` package from PyPI when one exists, or bundling
typeshed's own third-party stubs) is a real enhancement and an honest
non-goal for this phase's own exit bar — the catch-all's job is only to stop
lying about existence, not to simulate IntelliSense Viya's own interpreter
never offered to begin with.

**What 10b cannot settle without a hands-on spike, and why this session
did not attempt one.** Every source found this session documents the
stub-path mechanism working; none of them settles two mechanical questions
specific to this project's shape: (1) whether writing `python.analysis.stubPath`
into the workspace's own `settings.json` needs a **merge** against whatever
the user (or another extension) already put there, rather than a clobbering
overwrite — a real risk, since this project would be the first thing in this
codebase to write to a user's workspace settings file at all; and (2)
whether Pylance picks up a changed `stubPath` (or a regenerated stub tree
under an unchanged path) live, or needs a window reload, which matters
directly for "refresh environment" already being a user-facing action
(`environmentStore.ts` has no auto-expiry; a refresh is the only way stale
data ever changes). Phase 9's own scoping session hit the identical kind of
gap — documentation consistent with an answer, no source stating it
outright — and named a hands-on VS Code spike as 9a's first task rather than
guess; this phase should do the same, as **10b's own first task**, before
the stub-generation code is written. This sandbox cannot open an interactive
VS Code window to run that spike itself, which is exactly why it is
recorded here as a punch-list item rather than answered from documentation
alone.

**A second, independent surface — flagged as an option, not a requirement,
same shape as Phase 9's `ms-toolsai.jupyter` question.** VS Code's Python
tooling shipped a new, separately-versioned **Python Environments**
extension (`ms-python.vscode-python-envs`) that reached general availability
this year and is built to let a third-party extension register its own
**environment manager**, appearing in the Environments sidebar alongside
`venv`/`conda`/`poetry` — "any environment or package manager can build an
extension that plugs into the Python sidebar"
([`code.visualstudio.com/docs/python/environments`](https://code.visualstudio.com/docs/python/environments),
[Microsoft Python DevBlog, February 2026 release notes](https://devblogs.microsoft.com/python/python-in-visual-studio-code-february-2026-release),
both fetched 2026-09-04). Registering "Python on Viya" as a selectable
environment there is a real, attractive affordance — it would make a Viya
profile show up as a first-class environment choice rather than something
reached only through this extension's own commands — **but it is not what
gives Pylance real import resolution**, because the extension's own
documentation is clear that Pylance still resolves against the *interpreter*
an environment points to, walking its real `site-packages`; a Viya profile
has no local `sys.path` to point at, so registering it as an "environment"
without the stub-tree machinery above would just be a picker entry that
cannot actually back editing intelligence. Treat this as an optional,
later enhancement to 10a/10b's discoverability — not a dependency this
phase needs, and not required for the exit bar below, matching how Phase 9
treated `ms-toolsai.jupyter`: name it, don't require it, and don't let an
evolving, partially-rolled-out API (the extension itself states rollout was
at roughly one-in-five stable-channel users as of August 2025) become a
silent hard dependency.

**Testing.** Same shape as every prior port-and-adapt phase, adapted for the
fact that this phase's new logic is almost entirely local: `environment.ts`'s
existing probe and `EnvironmentStore` need no new tests to support this
phase, since neither changes. New unit-testable surfaces: the local
dist-info reader (pure function over a listing + file contents, fixture-driven,
no real local Python needed to test it — a fake `site-packages` tree is a
fixture like any other); the diff logic itself (two package lists in, three
buckets out — remote-only, local-only, version-mismatched); the stub-tree
generator (one `.pyi` string per package, deterministic given a package
list); and the settings-merge logic for `stubPath` (read-modify-merge-write
against a fixture `settings.json`, asserting it never drops a key it did not
own). The one surface no unit test can reach is "does Pylance actually
change its diagnostics after this" — that is 10b's own spike and, later, a
manual-test-pass item (`docs/dev/manual-test-pass.md`), not something the
automated suite can assert.

**Dialect risk.** None. Nothing here is a Viya-version-sensitive endpoint;
`environment.ts`'s probe (the one piece of this phase that talks to Viya at
all) was already dialect-agnostic when 3e shipped it, and this phase adds no
new wire call.

*Slices, refined from `PRODUCTION_PLAN.md`'s original one-line sketch ("10a
environment view and local/remote diff; 10b Pylance environment
reflection")*:

- **10a — Environment view: search/filtering + local/remote diff.**
  *Medium.* Local dist-info reader (new); diff logic (new); a `QuickPick`
  filterable view, additive to the existing plain-text document rather than
  replacing it (Plan, above); the existing document gains a diff section.
  Soft dependency on `ms-python.python` for the local side, degrading
  honestly to "unknown" when absent.
- **10b — Pylance environment reflection.** *Medium, pending its own spike's
  outcome* — smaller if a live `stubPath` change is picked up without a
  reload and workspace-settings merge proves straightforward; larger if
  either surprises. Spike first (Runbook, below), then the stub-tree
  generator, then the settings-merge writer.

*Exit:* a user can open a filterable view of everything installed on the
active Viya profile's interpreter, see at a glance what their local
environment has that Viya doesn't (and vice versa) without hand-comparing
two lists, and have an import that only exists on Viya stop being flagged
as a hard editor error it never was.

---

Everything above is the product. Everything below is breadth, and each phase
is independently valuable and independently shippable. Order is a
recommendation, not a dependency chain — reprioritise based on what users
actually ask for once v0.1.0 is in their hands.

---

## Runbook

_Scoped 2026-09-04, before any code was written — technical grounding (what
already exists, what's a genuine design question, what's a documented
mechanism vs. a hands-on unknown) came from the codebase survey and web
research described in the Plan section above. **Recommended order: 10b's
spike first, then 10a and the rest of 10b in either order** — the spike is
the one item whose answer could change how much of the rest is worth
building, so it should not wait behind 10a. Nothing here is a hard technical
barrier — this is a recommendation, not a dependency lock._

☑ **10b spike — run 2026-09-15, via the `pyright` CLI rather than a live VS
Code+Pylance window** (this session runs as Claude Code directly on the
developer's own machine, not the Claude Desktop sandbox, but no tool in this
session can drive VS Code's UI or read its Problems panel — there is no
diagnostics-inspecting tool available here). `pyright` is the open-source
analysis engine Pylance itself is built on and shares its stub-resolution and
caching logic, so it settles the two mechanical questions directly rather
than by inference from documentation; the one thing it cannot stand in for is
Pylance's own extension-layer behaviour, so a quick spot-check in a real VS
Code window is still worth doing before shipping, per Findings 10.1/10.2
below. Full method and evidence: Probe findings section.

- ☑ Confirmed: a `reportMissingImports` error becomes `reportMissingModuleSource`
  (a warning, not an error) the moment a matching `typings/<name>/__init__.pyi`
  catch-all stub exists and `stubPath` points at its parent — Finding 10.1.
- ☑ Confirmed: a **running** analysis process does **not** pick up a stub
  added, changed, or removed under an already-configured `stubPath` — three
  separate forced-reanalysis passes over 35+ seconds after the on-disk change
  all returned the pre-change diagnostic; a **fresh** process reading the
  same on-disk state immediately got it right. "Refresh environment" must
  say plainly that a window reload (or "Developer: Restart Language Server")
  is needed to see updated stub information — it cannot promise an immediate
  result — Finding 10.1.
- ☑ **New finding, not one either question anticipated**: a generated stub
  takes precedence over a same-named package that already resolves locally
  with real source, silently suppressing real type-checking for it (a
  deliberately wrong call passed clean once a matching stub existed, and was
  correctly flagged with the stub absent) — Finding 10.2. This means the
  stub generator must **not** stub every remote package unconditionally, the
  way this Plan section's prose originally described it: it may only stub
  packages 10a's diff reports as `remoteOnly` (or, when the local
  environment itself is unknown, everything remote, since nothing local
  exists to shadow) — never `localOnly` or `versionMismatched`, where a real
  local resolution already exists and stubbing it would make Pylance's
  answer worse, not better. Design correction folded into the stub-generator
  item below rather than into this Plan section's prose, per `CLAUDE.md`'s
  "amend, don't rewrite the core plan" rule.

☑ **10a — Environment view: search/filtering + local/remote diff.** Done
2026-09-14 — Sean's own call this session to take 10a first and hold the
10b spike for a later hands-on session, rather than block on it per this
Runbook's own (non-binding) recommended order.

- ☑ Local dist-info reader (`src/run/localPackages.ts`): given a
  `sysPrefix` (from `@vscode/python-extension`'s `resolveEnvironment`),
  enumerates `site-packages`'s `*.dist-info`/`*.egg-info` entries and parses
  each `METADATA`/`PKG-INFO`'s `Name`/`Version` — pure, fixture-driven
  (`test/unit/local-packages.test.ts`), no real local Python needed. The
  real filesystem read (`src/run/localPythonEnvironment.ts`) uses
  `vscode.workspace.fs`, not `node:fs` — that API reaches any `file://`
  path regardless of workspace membership, so it covers an interpreter
  installed anywhere on disk without widening `eslint.config.mjs`'s
  Node-built-in allow-list (ADR-0003) at all; no ADR amendment was needed.
- ☑ Diff logic (`src/run/environmentDiff.ts`): remote packages vs. local →
  three buckets (remote-only, local-only, version-mismatched), names matched
  PEP 503-normalised (so `My-Package`/`my_package` are not reported as a
  false mismatch) while the displayed name stays whichever side reported
  it; degrades to `local-unknown` when `ms-python.python` is absent, has no
  active environment, or the environment cannot be resolved — never a hard
  failure. 100% unit-covered.
- ☑ `Python on Viya: Search environment` (`pythonOnViya.searchEnvironment`,
  `src/run/commands.ts`) — a `QuickPick` over the current profile's cached
  packages (sorted by name, VS Code's own built-in filter-as-you-type),
  additive to (not replacing) `Show environment`'s existing plain-text
  document. Never force-probes, matching `Show environment`'s own
  cache-first default. Picking an entry copies `name==version` to the
  clipboard (via an injectable port, `RunCommandDeps.writeClipboardText`,
  so the integration suite never touches a real system clipboard).
- ☑ Extended `environmentDocument.ts`'s rendered text with a "Local
  comparison" section below the package list, reusing `environmentStore.ts`'s
  existing cache — no new persistence. `environmentPanel.ts`'s
  `provideTextDocumentContent` is now `async`, reading the local side fresh
  on every render (one local directory walk, not a network call).

☑ **10b — Pylance environment reflection (after the spike above).** Done
2026-09-15.

- ☑ **Probe payload widened first** (developer decision, 2026-09-15, in
  response to a real gap the spike's own design review surfaced): the
  Stage-2 probe (`environment.ts`) reports only the PyPI *distribution* name
  per package (`importlib.metadata`'s `Name`), never the *import* name — and
  the two differ for many common packages (`Pillow`→`PIL`,
  `beautifulsoup4`→`bs4`, `PyYAML`→`yaml`, `opencv-python`→`cv2`,
  `scikit-learn`→`sklearn`, `python-dateutil`→`dateutil`, among others). A
  stub generated at `typings/Pillow/` does nothing for `import PIL`. Fix:
  add a best-effort import-name list per distribution to the probe's own
  JSON payload — `distribution.read_text("top_level.txt")` first (the
  setuptools-written, per-distribution, most-authoritative source when
  present), then `importlib.metadata.packages_distributions()` (3.10+,
  global reverse-mapping, guarded by `hasattr` since Viya's Python version
  is not this project's to assume) as a second source, then the
  distribution name itself with `-`/`.` normalised to `_` as a last-resort
  guess — never leaving a package with zero import names, and never letting
  one malformed entry's lookup fail the whole probe (`environment.ts`'s own
  existing per-entry `try`/`except` discipline, extended, not replaced).
  This is a wire-shape change to an already-shipped probe; its own dated
  finding goes here once implemented, and every place the old payload shape
  was documented gets swept, per `CLAUDE.md`'s "every claim carries its
  evidence."
- ☑ Stub-tree generator (`src/run/stubGenerator.ts`): one
  `typings/<import-name>/__init__.pyi` per package, a permissive catch-all
  module stub (Plan, above) — pure function, fixture-driven, 100% covered.
  **Scoped to 10a's `remoteOnly` diff bucket, not every remote package** —
  Finding 10.2 (Probe findings, below) found that a generated stub takes
  precedence over a same-named package that already resolves locally with
  real source, silently suppressing real type-checking for it; stubbing
  `localOnly` or `versionMismatched` entries would make Pylance's answer
  worse, not better. When the local environment itself is `local-unknown`,
  stub everything remote — there is nothing local to shadow. Only the
  dotted import name's first segment is stubbed (a namespace package's
  submodules stay unresolved either way — Plan section's own stated
  non-goal, not a new gap).
- ☑ **Settings write simplified from the planned hand-rolled JSON
  merge to `vscode.workspace.getConfiguration(...).update(...)`**
  (`src/run/pylanceStubSync.ts`, `src/run/stubPathSetting.ts`) — this
  project's own `@types/vscode` (`node_modules/@types/vscode/index.d.ts`)
  documents `WorkspaceConfiguration.update` as the sanctioned way to write
  one workspace setting, and it already does a real read-modify-write
  against `settings.json` (comments and unrelated keys survive) without this
  project hand-rolling a JSONC parser. The type definition's own `@throws`
  list is exactly the two real hazards a hand-rolled writer would also have
  had to handle: *"configuration which is not registered"* (Pylance not
  installed) and *"configuration to workspace ... when no workspace is
  opened"* — both wrapped in `try`/`catch`, both degrading to a logged,
  non-fatal outcome (`PylanceStubSyncResult`'s `"write-failed"`/
  `"no-workspace"` arms) rather than a thrown error. **Never overwrites an
  already-customised `stubPath`**: `decideStubPathAction`
  (`stubPathSetting.ts`, pure, 100% covered) reads the setting's
  **workspace-scoped** value via `inspect(...).workspaceValue` — not the
  *effective* value, which would conflate "genuinely unset" with "Pylance's
  own default" and refuse to ever write — and only calls `.update(...)`
  when that is `undefined` or already equal to this feature's own path.
  Generated stubs live at their own `.pythonOnViya/typings/` directory, not
  the conventional bare `typings/` the Plan section originally named — a
  user can already have a real `typings/` folder Pylance reads via
  `stubPath`'s own documented default with no explicit setting at all, and
  this feature's own pruning (deleting a stale top-level entry no longer
  desired) would risk deleting a user's own content in that directory; a
  project-namespaced directory is safe to fully own, regenerate and prune.
  Multi-root: the first workspace folder only, a deliberate, modest scope
  limit (module's own doc comment).
- ☑ Wired: a genuinely fresh probe (from any of `showEnvironment`/
  `refreshEnvironment`/`searchEnvironment`, whichever first triggers one —
  not only `refreshEnvironment` specifically, since the Runbook's original
  phrasing undersold it) now syncs the stub tree via
  `ensureProbedEnvironment`'s own "just probed" branch in `commands.ts`,
  never on a cache hit. `showEnvironmentImpl` shows a one-line notification
  that a reload is needed **only when the sync actually changed the stub
  tree** (Finding 10.1: a reload is always needed *when something changed*,
  not literally unconditionally on every call with nothing to report);
  `searchEnvironment` does not surface it — a quick clipboard lookup has no
  business nagging about a Pylance reload. Every non-`"synced"` outcome
  (`"no-workspace"`, `"stub-path-conflict"`, `"write-failed"`) is logged via
  `log.warn`, not a popup — a persisted condition, not a one-off failure the
  user needs to dismiss on every refresh.
- ☑ Documented the optional Python Environments extension
  (`ms-python.vscode-python-envs`) registration as a possible follow-on
  enhancement, not a dependency this phase requires (Plan, above) —
  `docs/python-environment.md`'s "What is not here yet" section, no code.

**10a verification, 2026-09-14.** `npm run verify`'s full chain green
locally (`format:check`, `lint`, `typecheck`, `check:copyright`,
`check:secrets`, `check:coverage-scope`, `check:contracts`, `build`,
`coverage`): 1771 unit tests, coverage 96.09/95.57/95.98/96.09
lines/branches/functions/statements, every new pure module
(`environmentDiff.ts`, `environmentDocument.ts`, `localPackages.ts`) at
100%. `npm run test:integration` also green, 436 passing (`localPythonEnvironment.ts`
and the `commands.ts` changes are `vscode`-importing, so they're exercised
here rather than at the unit tier — `.c8rc.json`'s exclude list gained
exactly `localPythonEnvironment.ts`). New dependency:
`@vscode/python-extension` 1.0.6 (devDependency, pinned exact — bundled by
esbuild like every other runtime dependency in this project).

**Adversarial self-review, 2026-09-15 (before the PR exists, per
`CLAUDE.md`).** One real finding: `environmentPanel.ts`'s
`provideTextDocumentContent` called the new `await
readActiveLocalEnvironment()`/`diffEnvironments(...)` path with no
`try`/`catch` around it — `localPythonEnvironment.ts`'s own doc comment
promises the whole path "degrades to unknown, never a thrown error," but
that guarantee only actually held for `PythonExtension.api()` itself;
`getActiveEnvironmentPath()`/`resolveEnvironment()` were called unguarded,
so an extension-internal error (a misbehaving Conda/Poetry resolver, a
stale/deleted interpreter) would have propagated out and broken the whole
`Show environment` document — including the previously-reliable remote
package list — instead of degrading only the new "Local comparison"
section. **Fixed**: `readActiveLocalEnvironment`
(`src/run/localPythonEnvironment.ts`) now wraps the
`getActiveEnvironmentPath`/`resolveEnvironment` pair in its own
`try`/`catch`, returning `{ kind: "unknown" }` on any failure from either
call, matching the doc comment's existing promise rather than only the
`api()` call. `npm run verify` (1771 unit, same coverage figures above) and
`npm run test:integration` (436 passing) both re-run green after the fix.
Everything else the review flagged (l10n coverage, PEP 503 normalisation,
the `eslint.config.mjs` version-branching-rule workaround for
`remoteVersion`/`localVersion`, `ensureProbedEnvironment`'s cache-vs-force
logic, test quality, no secrets/`console.*`/`any`) read as solid — no
further changes. Manual-test items 10.1–10.5 added to
`docs/dev/manual-tests/phase-10.md`, including 10.3 as this exact
regression's own live repro (a deleted interpreter folder must not blank
the whole document).

**Manual-test pass, 2026-09-15 (Sean).** All five items —
10.1 (three-way diff, PEP 503 normalisation), 10.2 (honest "unknown" with
no local interpreter), 10.3 (a deleted/stale interpreter degrades only the
Local comparison section, live repro of the review fix above), 10.4
(`Search environment` filters and copies `name==version` to the clipboard),
10.5 (`Search environment` never force-probes a stale cache) — run and
passed against a real VS Code window. 10a is now fully verified: checks,
adversarial review, and manual test all green. PR opened for 10a
([#178](https://github.com/Shai-Alit/sas-py-vscode/pull/178)).

**PR #178 also picked up two docs-only merges from `main` while it was
open** — [#179](https://github.com/Shai-Alit/sas-py-vscode/pull/179) (the
1.0 definition-of-done) and
[#180](https://github.com/Shai-Alit/sas-py-vscode/pull/180) (the Phase
8/9 documentation catch-up) — both merged cleanly (`STATUS.md` was the
only file either touched that this branch also touched, and each landed in
a different section of it), verified with `check:secrets`/`check:docs`
after each merge, no conflicts.

**PR #178 review, 2026-09-15.** Codex's automated review found one real,
major-severity defect: `readActiveLocalEnvironment`
(`src/run/localPythonEnvironment.ts`) trusted `ResolvedEnvironment`'s own
TypeScript type, which declares `executable.sysPrefix` and
`version.major`/`version.minor` as always populated once `version` itself
is defined. Real `resolveEnvironment` calls don't always honour that —
`sysPrefix` can come back `""` and `version.major`/`minor` `undefined`
regardless (a documented vscode-python defect,
[microsoft/vscode-python#20147](https://github.com/microsoft/vscode-python/issues/20147),
confirmed by web search this session). The unguarded code would have built
a `undefined/Lib/site-packages`-shaped path, which `readLocalPackages`
reads back as an empty list — silently reporting *every* remote package as
"remote-only" instead of the honest "local environment unknown" 10.2 tests
for. **Fixed**: `sysPrefix`/`major`/`minor` are now checked for real values
(not just checked against the type) before building the site-packages path,
falling back to `{ kind: "unknown" }` otherwise — `localPythonEnvironment.ts`
stays excluded from the coverage gate (`.c8rc.json`), same as before, since
the integration test host cannot fabricate a `resolveEnvironment` result
with this specific shape. The review's other finding — three Phase 9
notebook bullets in this PR's `CHANGELOG.md` diff, which turned out to be a
genuine backfill of entries PRs #172/#176/#177 never added when they merged
— was acknowledged rather than split out: the entries are correct and
belong under `## [Unreleased]` regardless of which PR adds them, so
backfilling them here rather than opening a separate PR for a three-line
gap was the pragmatic call. `npm run verify`'s full chain re-run green
after the `localPythonEnvironment.ts` fix (see below); no other findings.

**PR #178 review, round 2, 2026-09-15 (after merging main's PR #179 docs
into the branch).** Two more minor findings, both in
`src/run/localPythonEnvironment.ts`, both fixed. First: `sitePackagesPath`
reads the bare `process.platform` global rather than an import, so
`eslint.config.mjs`'s `no-restricted-imports` rule (ADR-0003's enforcement
mechanism) never sees it — and the call was unguarded, so a `ReferenceError`
in an environment where `process` does not exist (a web extension host,
which this module's own doc comment already names as a case it degrades
for) would have propagated out of `readActiveLocalEnvironment`, through
`environmentPanel.ts`'s unguarded `await`, and blanked the whole `Show
environment` document — the identical failure shape the first adversarial
review round already fixed twice over for the two calls above it. **Fixed**:
the `readLocalPackages`/`sitePackagesPath` call is now wrapped in its own
`try`/`catch`, degrading to `{ kind: "unknown" }` like every other early
return in this function. Not a live bug today — `package.json` has no
`browser` entry point, so a web host never actually runs this — but the gap
in the graceful-degradation guarantee was real. The reviewer additionally
suggested extending the ADR-0003 lint rule to catch bare
`process`/`Buffer`-style globals, not just imports; left as a follow-up for
Sean to decide on, not applied here — a lint-rule change is a wider,
independent decision than this PR's own scope. Second: `LocalEnvironment`'s
`known` arm carried a `version` field (`resolved.version.sysVersion`) that
nothing downstream ever read — `environmentPanel.ts` only pulls
`local.packages` out of it. **Fixed**: the field is dropped rather than
kept for a hypothetical future consumer, per this project's own
no-speculative-fields convention; nothing else referenced it (`grep -rn
"LocalEnvironment"` before the change turned up only this file and
`environmentPanel.ts`). `npm run verify` (1771 unit, same coverage figures)
and `npm run test:integration` (436 passing) both re-ran green after both
fixes.

**10a merged, 2026-09-15.** Squash-merged as
[PR #178](https://github.com/Shai-Alit/sas-py-vscode/pull/178), commit
`62cf217`. This is 10a's final state — the punch-list item above is done;
10b (below) is the only open work left in this phase.

**10b spike, findings, and implementation, 2026-09-15.** Run from a fresh
session picking up Phase 10 after 10a's merge. The spike itself, and the
extra design-review finding it turned up before any stub-generation code was
written, are recorded in the Runbook's own "10b spike" entry above and
Findings 10.1/10.2 below — both settled via the `pyright` CLI (the
open-source engine Pylance is built on) rather than a live VS Code+Pylance
window, since this session (Claude Code running directly on the developer's
machine, not the sandboxed Claude Desktop) still has no tool that can drive
VS Code's UI or read its Problems panel. Two design decisions came out of
that review, both applied: widening the Stage-2 probe's payload with a
best-effort import-name list (developer's own call, asked and answered before
any code was written — `AskUserQuestion`, "Extend the probe" over "ship
distribution-name stubs only"), and scoping stub generation to 10a's
`remoteOnly` bucket rather than every remote package (Finding 10.2, no
separate ask needed — a straightforward correctness fix once the shadowing
regression was demonstrated). The settings-write approach also changed from
the Runbook's own original plan (a hand-rolled JSON read-modify-merge-write)
to `vscode.workspace.getConfiguration(...).update(...)`, once this project's
own `@types/vscode` showed that API already does the safe read-modify-write
this feature needed — see the Runbook's own settings-write punch-list item,
above, for the full reasoning.

**10b verification, 2026-09-15.** `npm run verify`'s full chain green locally
(`format:check`, `lint`, `typecheck`, `check:copyright`, `check:secrets`,
`check:coverage-scope`, `check:contracts`, `build`, `coverage`): 1791 unit
tests, coverage 96.14/95.61/96.02/96.14 lines/branches/functions/statements,
every new pure module (`stubGenerator.ts`, `stubPathSetting.ts`) at 100%.
`npm run test:integration` also green, 438 passing — `pylanceStubSync.ts`
joins `.c8rc.json`'s exclude list (`vscode`-importing); its own integration
suite covers the one branch reachable without a real open workspace
(`"no-workspace"`, since this project's shared integration test host opens
none — the same reason no other integration test in this repository exercises
`vscode.workspace.workspaceFolders`). The `"synced"`/`"stub-path-conflict"`/
write-failure paths need a real open workspace, which only a hands-on VS Code
session can provide — manual-test items 10.6–10.11
(`docs/dev/manual-tests/phase-10.md`) cover them, not yet run. Sanity-checked
the widened probe's Python source directly against a real local interpreter
(not a Viya deployment — this is client-side Python, no wire call) before
writing any TypeScript against it: extracted the compiled `PROBE_SOURCE` and
ran it with a real `python.exe` (3.14.6) over a 208-package real-world
`site-packages`, confirming the `top_level.txt` → `packages_distributions()`
→ normalised-guess fallback chain resolves exactly the known
distribution/import-name mismatches (`PyYAML`→`yaml`, `beautifulsoup4`→`bs4`,
`more-itertools`→`more_itertools`, and 205 others) with no exceptions and
valid JSON out.

**Adversarial self-review, 2026-09-15 (before the PR exists, per
`CLAUDE.md`).** Four real, blocking defects, all fixed in this branch before
push:

- **Finding 10.2's mitigation was only half the hazard.** Scoping stub
  generation to `remoteOnly` (above) stops a generated stub from shadowing an
  *installed* package that already resolves locally — it says nothing about a
  top-level name that is the user's own workspace source and was never an
  installed distribution at all (`tests`, `utils`, and similarly generic names
  turn up in real `top_level.txt` listings often enough that the collision is
  not hypothetical), and it gets worse in the local-unknown arm, where every
  remote package is stubbed with nothing local to compare against. **Fixed**:
  `stubGenerator.ts`'s new `excludeWorkspaceOwnedNames` drops any generated
  stub whose top-level name is already a real directory or `.py` file at the
  workspace root — Pyright resolves `stubPath` before workspace source, so an
  unexcluded collision would otherwise win and silently disable real
  type-checking for the user's own module. `pylanceStubSync.ts`'s
  `writeStubTree` now lists the workspace root (a new `RealFs.
  listWorkspaceRootNames`, alongside the existing stub-tree-root listing) and
  applies the exclusion before ever writing anything.
  `docs/python-environment.md`'s existing claim ("a package already
  resolvable in your local environment is never stubbed") gained a sentence
  for this second protection, which is a different claim from the first.
  Whether the local-unknown arm should keep stubbing *every* remote package,
  or something narrower, is a real open question this fix does not settle —
  flagged to the developer rather than decided here, since it is a scope
  question about the feature's own behaviour, not a straightforward
  correctness fix.
- **The reload notice nagged on every unchanged refresh.** `reloadAdvisable`
  was `true` whenever `syncPylanceStubs` returned `"synced"` with at least one
  package, regardless of whether the sync actually changed anything on disk —
  so **Refresh Environment Info** against an already-synced profile repeated
  "reload the window" every time. **Fixed**: `stubGenerator.ts`'s
  `StubTreeSyncPlan` gained a `changed` field (a deletion, or a desired name
  not already present — deliberately not "did file content change", since
  `toWrite` always carries the full desired set regardless); `syncPylanceStubs`
  threads it through as `PylanceStubSyncResult`'s own `changed`, also `true`
  the first time `stubPath` itself is written. `commands.ts` now advises a
  reload only when `changed` is `true`.
- **`Search Environment` silently wrote to the workspace with no signal.** A
  cache-miss `searchEnvironmentImpl` probes exactly like `showEnvironmentImpl`
  does (10a's own cache-first default, unchanged) — which since 10b also means
  it can write generated stubs and edit `settings.json`, and it discarded
  `reloadAdvisable` outright, so the user got no notice at all.
  `docs/python-environment.md` also overstated this ("it never probes on its
  own"), a claim that was already inaccurate before 10b and became more
  consequential once a cache-miss probe started writing files. **Fixed**:
  `searchEnvironmentImpl` now shows the same reload notice
  `showEnvironmentImpl` does, and the doc section is reworded to say what
  actually happens.
- **Three bare `catch {}` blocks discarded the real cause**, most seriously in
  `listTopLevelDirectories`: any read failure — not just "the root does not
  exist yet" — read back as an empty listing, so a genuine permissions error
  on the *listing* call would have silently skipped pruning and left a stale,
  shadowing stub in place (Finding 10.2's own failure, reached by a different
  route). **Fixed**: a new `isMissingRoot` check distinguishes a real
  `FileSystemError` with code `"FileNotFound"` (a legitimate empty listing —
  the very first sync) from anything else, which is now rethrown and reaches
  `syncPylanceStubs`'s own `catch`. `PylanceStubSyncResult`'s `"write-failed"`
  arm gained a `detail: string` (the caught error's own message), logged by
  the caller, so an `EACCES` or a read-only workspace is diagnosable from the
  log instead of reading as "it failed" with no cause.

Also folded in from the review's "worth fixing" list, since they were
contained, non-scope-expanding corrections: the stub-tree write itself now
runs inside `ensureProbedEnvironment`'s existing progress scope rather than
after it (previously unbounded and outside any progress UI once probing
itself had finished); `syncPylanceStubs` now checks the workspace folder's own
URI scheme and degrades to a new `"unsupported-workspace"` outcome for a
non-`file:` folder (this extension's own `sasContent:` tree, `vscode-vfs:`, or
similar) rather than writing hundreds of files nothing can read; a
`remoteOnly` name that cannot be found in the profile's own package list
(should never happen — `diffEnvironments` derives it from that same list) is
now logged instead of silently dropped; and a `stub-path-conflict` outcome now
shows one `inform()` in addition to the existing log line, so the user is not
left wondering why nothing happened.

The decision logic itself (`syncStubsForFreshProbe`'s local-unknown-vs-
remoteOnly selection, and what each `PylanceStubSyncResult` outcome should log
or tell the user) moved out of `commands.ts` into a new pure module,
`src/run/stubSyncPlan.ts` — `commands.ts` imports `vscode` and is excluded
from the unit coverage tier entirely, and the review's own "no test exercises
any of this in commands.ts" finding was real: reaching these branches through
a live backend probe would need a purpose-built `ComputeClient` fixture (the
same one `proc-python-backend.test.ts`'s own `probeRuntime` suite builds,
private to that file) wired all the way through `RunCommandSessions`/
`BackendCache`, disproportionate to what these decisions actually are. Pulling
them into their own pure module made them directly unit-testable instead
(`test/unit/stub-sync-plan.test.ts`, new) — the same split this codebase
already draws for `stubGenerator.ts`/`stubPathSetting.ts`.

Four items came out of the review that were not straightforward correctness
fixes — each discussed with the developer (2026-09-15) rather than decided
unilaterally, per this project's "expand scope on your own" rule:

- **`workspaceFolderValue` — settled, no code change.** The concern was that
  `commands.ts`'s `stub-path-conflict` check only inspects
  `WorkspaceConfiguration.inspect(...).workspaceValue`, missing a value set at
  folder scope. Verified against VS Code's own documented `inspect()`
  semantics and a confirmed, long-standing report
  ([microsoft/vscode#34386](https://github.com/microsoft/vscode/issues/34386)):
  `workspaceValue` and `workspaceFolderValue` are genuinely different scopes
  only in a real multi-root workspace (a `.code-workspace` file naming several
  folders); in the single-folder case this feature already, deliberately
  scopes itself to (`pylanceStubSync.ts`'s own "Multi-root: the first
  workspace folder only" doc comment), both read the same
  `.vscode/settings.json` and always agree. So checking `.workspaceValue`
  alone misses nothing for what this feature handles today. **This becomes a
  real gap only if multi-root support is ever added** — carried forward to
  `phase-11.md` (below) rather than left as a silent trap for whoever adds it.
- **Local-unknown stubs every remote package — kept as-is.** The alternative
  (stub nothing when there's no local interpreter to diff against) would
  leave exactly the user this feature helps most — no local interpreter
  selected — with the same `reportMissingImports` noise it exists to quiet.
  Finding 10.2's shadowing hazard does not apply here (nothing local to
  shadow), and the workspace-source-shadow fix above protects the user's own
  code regardless of which arm produced the stub list. Decided: keep the
  existing behaviour.
- **A `pythonOnViya.*` opt-out setting — deferred, not built.** Nobody has
  asked for one, and it is a real (if bounded) scope addition — a new
  `package.json` configuration contribution, wiring, and documentation.
  Carried forward to `phase-11.md` as a candidate, not a commitment.
- **A "Reload Window" action button on the reload notice — built.** Small and
  self-contained: `showEnvironmentImpl`/`searchEnvironmentImpl`'s shared
  `informReloadAdvisable` now shows the notice with a "Reload Window" action
  that runs `workbench.action.reloadWindow` when picked, instead of naming the
  command in prose only. Gated behind the same `deps.inform` injection seam
  as every other message in this module: a test double bypasses the real
  `showInformationMessage` call (and the button) entirely, so no test can
  accidentally trigger a real window reload inside the shared extension host
  process every integration test in this suite runs in.

**10b re-verification, 2026-09-15 (after the review fixes and the reload
button above).** `npm run verify`'s full chain green locally: 1812 unit
tests, coverage 96.17/95.63/96.04/96.17 lines/branches/functions/statements —
`stubGenerator.ts`, `stubPathSetting.ts`, and the new `stubSyncPlan.ts` all at
100%. `npm run test:integration` also green, 438 passing.

**Developer's own independent adversarial pass, 2026-09-15 (`git diff main`
against the full branch, plus the allowed static gates re-run by hand — one
real, priority-one finding.** `commands.ts`'s own 10b wiring
(`syncStubsForFreshProbe`, `informReloadAdvisable`, and the `reloadAdvisable`
flag threading through `ensureProbedEnvironment` into both
`showEnvironmentImpl` and `searchEnvironmentImpl`) had a real injection seam
(`RunCommandDeps.pylanceStubs`) built specifically so a test could reach it,
but nothing did — including the exact `changed: false` no-nag regression the
first review round had just fixed. **Fixed**: a new, purpose-built test
fixture, `test/helpers/recorded-probe-connection.ts`, scripts a
`ComputeClient` for `probeRuntime()`'s own successful call sequence
(`execute` → `log` → `state` → `variables` → `getFiles` →
`getDirectoryMembers` → `getFileProperties` → `getFile` → `deleteFile`) —
trimmed from `proc-python-backend.test.ts`'s own larger, private `router()`,
since neither existing shared connection fixture supports a successful
probe (`recorded-connection.ts`'s own doc comment already says why:
its simulated `getDirectoryMembers` always answers empty). Five new cases in
a new file, `test/integration/run/commands-pylance-stub-sync.test.ts` (the
same file-per-concern split `commands-backend.test.ts`/
`commands-diagnostics.test.ts` already draw around `commands.test.ts`'s own
"guards" suite), drive a real fresh probe through `commands.ts` and assert:
every remote package reaches `deps.pylanceStubs` when the local environment
is unknown (the only diff this project's shared integration test host can
produce — no `ms-python.python` installed — the `remoteOnly` re-lookup
branch stays covered at `stub-sync-plan.test.ts`'s unit tier instead); the
`changed: true`/`changed: false` reload-notice regression, for both
`showEnvironment` and `searchEnvironment`; and that `stub-path-conflict`/
`write-failed` each produce the right log line (asserted via
`test/helpers/auth-host.ts`'s existing `recordingLog`) and the right
user-facing message. First run against this new fixture actually failed all
but one case — the fixture's own `probeFileName` was a hand-typed guess
rather than the real `ENVIRONMENT_PROBE_FILENAME` constant, so every probe
"succeeded but left no file behind"; fixed by importing the real constant
rather than restating it. The reviewer's second, minor finding — unsanitised
`name`/`version` strings (Viya's own probe, `importlib.metadata`'s record,
never character-validated) land in a `#`-comment line of a generated `.pyi`
file with no validation, so a newline in either would let that text escape
the comment as literal file content — was put to the developer rather than
fixed unilaterally (not code execution, since Pylance only parses a `.pyi`
for type information and never runs it, but a real gap against this
project's general posture toward untrusted Viya-sourced strings). **Decided:
sanitise.** `stubGenerator.ts`'s new `sanitiseForComment` strips C0 control
characters (CR/LF included) from both values before they reach the comment
line; `stub-generator.test.ts` gained a case pinning that a name/version
carrying a newline and a fake `#` line cannot escape the real comment.

Also caught in this session's own process, not by either review round:
`check:secrets` (`scripts/check-secrets.mjs`) reads `git ls-files`, so every
new file this slice added was silently unscanned until `git add`. Staged
before the final `check:secrets` run below; every other `npm run verify` step
scans the filesystem directly and was unaffected.

**10b final re-verification, 2026-09-15 (after the missing-coverage fix and
the sanitisation fix above).** `npm run verify`'s full chain green locally:
1813 unit tests, coverage 96.17/95.63/96.05/96.17
lines/branches/functions/statements. `npm run test:integration` green, 443
passing (438 + 5 new `commands-pylance-stub-sync.test.ts` cases).
`npm run check:secrets` green, 502 files scanned (up from 492 — confirms the
new files are now actually covered, not just present).

**Manual test session, 2026-09-15 (Sean, real VS Code + Pylance window) —
§10.8 fails on a fresh package; the reload cost itself is flagged as
unacceptable.** First pass used `saspy`: uninstalling it locally produced the
`reportMissingModuleSource` downgrade within seconds, before **Refresh
environment info** was ever run — invalid signal, discarded, once traced to
`saspy` already carrying a generated stub on disk from an earlier test today.
Re-run against `babel` (confirmed never stubbed in this workspace before):
uninstalling it locally correctly produced `reportMissingImports`
immediately; running **Refresh environment info** correctly left that
diagnostic unchanged (matches Finding 10.1's first half). Accepting the
resulting "reload the window" notice and completing a real reload — full
extension-host restart, ~60–90 seconds, every extension including this one
restarting from scratch, and this session's Viya connection dropped and
needing to be manually re-established — did **not** clear or downgrade the
`babel` diagnostic; it still read `reportMissingImports` after the reload
completed. Root cause not investigated this session, at the developer's own
direction — recorded as an open, unresolved result (§10.8 in
`docs/dev/manual-tests/phase-10.md` marked failed, not re-attempted since).

**Standing objection, same session: the reload-required design itself,
independent of whether §10.8 above turns out to be a separate bug.** Even
where the reload does what Finding 10.1 says it should, paying a ~60–90
second full window reload — every extension restarting, the current Viya
connection dropped and requiring a manual reconnect — every time a refresh
changes the remote-only package set, in exchange for a generic, attribute-less
catch-all stub (10b's own stated non-goal is real type information; the best
case is silencing `reportMissingImports` in favour of a `reportMissingModuleSource`
warning) is judged by the developer to be an unacceptable cost as currently
built, not a UX rough edge to note in passing. This needs a real design
response before 10b can ship — candidates not yet evaluated: whether
`python.analysis.stubPath` truly requires a full window reload for every
change or only some (Finding 10.1's own evidence is from the `pyright` CLI and
two upstream issue reports, not an exhaustive survey of what does and doesn't
need one), whether the notice should be less frequent (batching, or only
firing when the affected packages are actually imported somewhere in the open
workspace), or whether the reload cost means the generated-stub approach
itself needs reconsidering against 10a's existing diff view doing the same
"tell the user what's missing" job without touching Pylance's own state at
all. Not decided; carried here rather than in `STATUS.md`, since nothing is
resolved yet.

**Proposed design change, 2026-09-15 (research pass, in response to the
standing objection above) — offer "Restart Language Server" ahead of
"Reload Window", not instead of it.** Not yet implemented; written up here
for a coding pass to act on, with a re-run of §10.8 afterward.

*Problem this responds to.* `informReloadAdvisable` (`commands.ts`) currently
offers exactly one remedy — a "Reload Window" action button running
`workbench.action.reloadWindow` — every time a fresh probe changes the stub
tree. That command tears down the entire extension host: every extension
restarts, not just Pylance, and this project's own live Viya connection is
among the casualties, needing a manual reconnect afterward. Measured cost in
this session's own manual test: ~60–90 seconds. The standing objection above
is that this cost, paid on every stub-changing refresh, is too high in
exchange for what 10b's own stub ever promises (a bare catch-all, never real
type information).

*What web research (2026-09-15, this session) found.* Microsoft's own
Pylance troubleshooting documentation states the recommended step after any
`python.analysis.*` configuration change — `stubPath` included — is
**Python: Restart Language Server**, not a full window reload
([`pylance-release/docs/howto/unresolved-imports.md`](https://github.com/microsoft/pylance-release/blob/main/docs/howto/unresolved-imports.md),
[`pylance-release/docs/howto/settings-troubleshooting.md`](https://github.com/microsoft/pylance-release/blob/main/docs/howto/settings-troubleshooting.md),
both fetched this session). That command restarts only the Python language
server process, not the whole extension host — it has no structural reason
to touch this project's own Viya connection or any other extension, and
should cost a small fraction of a full reload. It is not, however, fully
reliable on its own: multiple `microsoft/pylance-release`/`microsoft/vscode-python`
issues describe the command failing outright in some contexts (remote/SSH,
dev containers) or not fully re-indexing a multi-root workspace afterward
([Issue #2873](https://github.com/microsoft/pylance-release/issues/2873),
[Issue #6405](https://github.com/microsoft/pylance-release/issues/6405), both
fetched this session) — the pattern in these reports is "try it first, fall
back to a full reload if it doesn't clear things up," not "it always works."

*Proposed change.* `informReloadAdvisable`'s notice gains a second action
button, offered alongside (not replacing) "Reload Window": a "Restart
Language Server" action, presented first/primary, that runs the Python
extension's own language-server-restart command. If the user picks it and
diagnostics still don't reflect the change, "Reload Window" remains available
as the fallback it already is today — this is additive, not a replacement of
the existing remedy. The notice's own message text should say as much (something
like "reload the window, or try restarting the Python language server
first"), rather than implying the cheaper option is guaranteed to work.

*What the coding pass needs to settle, not assume:*
- **The real command ID.** GitHub issue titles reference `Python: Restart
  Language Server`, and one issue's own title names
  `python.analysis.restartLanguageServer` as the underlying command — but
  that is the command ID as it appeared in someone else's bug report, not
  confirmed against this project's own supported `ms-python.python`/Pylance
  version range. Verify it directly (e.g. `vscode.commands.getCommands()`
  against a real installed Python extension, or the extension's own
  `package.json` `contributes.commands`) before wiring it in.
- **Graceful handling when the command doesn't exist or throws** — per the
  "command not found" reports above, this is a real, not hypothetical, case
  for some environments. `informReloadAdvisable` must not let a missing/
  failing restart command take down the notice or throw somewhere
  unhandled; it should degrade to "Reload Window" being the only working
  button, same as today.
- **Whether Restart Language Server actually clears a stub-tree change that
  a full Reload Window did not** — §10.8's own open result (Finding 10.3)
  is that a genuine window reload, the heaviest remedy available, did not
  clear `babel`'s diagnostic. This proposal does not explain that result and
  is not a fix for it. If Restart Language Server also fails to clear the
  same kind of case on re-test, that would deepen Finding 10.3 rather than
  resolve it, and would point at something other than "which restart
  mechanism" as the real cause — worth watching for specifically when §10.8
  is re-run.

*Non-goal:* this proposal is about the cost of the remedy, not a fix for
Finding 10.3's own open question. Re-running §10.8 after this lands is what
will show whether either question moves.

---

## Probe findings

Findings in this section are numbered `10.x`, per the phase-scoped
finding-numbering scheme adopted 2026-09-09 (`STATUS.md`, repo-root
`CLAUDE.md`) — this phase file's own scoping session originally assumed the
first would continue the old global sequence from Finding 92 (`phase-8.md`,
since renumbered `8.6`), the same starting point `phase-9.md`'s scoping
session also assumed; a latent collision the new scheme avoids.

**No live-Viya probe was run during scoping (2026-09-04) or 10a
(2026-09-14/15), deliberately, not by oversight** — the same reasoning
Phase 9's scoping session gave for its own phase. Every question those two
slices raised was either already-settled Viya behaviour (the Stage-2 probe's
own wire shape, settled in Phase 3e and untouched by 10a) or a **VS
Code/Pylance client-side** question, answered instead by `viya-api-probe`'s
sibling discipline applied to that client — see Findings 10.1/10.2 below,
both from 10b's own spike.

**Finding 10.1 (2026-09-15) — a `stubPath` change is not picked up by a
running analysis process; it needs a restart.** Verified via the `pyright`
CLI (the open-source engine Pylance is built on, sharing its import-resolution
and caching logic — see the Runbook's 10b spike entry, above, for why this
session used it in place of a live VS Code+Pylance window). Method: a scratch
`pyrightconfig.json` with `"stubPath": "typings"`; a one-shot `pyright
main.py` against `import totallyfakepkg123` first with no stub (baseline:
`reportMissingImports`, error) and then with a hand-written
`typings/totallyfakepkg123/__init__.pyi` catch-all present (confirms:
`reportMissingModuleSource`, warning — the Plan section's predicted outcome).
Then `pyright --watch --outputjson main.py` kept running while, on disk: the
existing stub was deleted, and separately a second import
(`anotherfakepkg456`) had its stub added for the first time — each change
followed by touching `main.py` to force a fresh analysis pass. Across three
forced passes over 35+ seconds, the running process kept reporting the
**pre-change** diagnostic for both packages (stale warning for the deleted
stub, stale error for the newly-stubbed one); a fresh, non-watch `pyright`
invocation against the same on-disk state immediately reported both
correctly. Independently corroborated by real-world Pylance bug reports
found via web search: [microsoft/pylance-release#4882](https://github.com/microsoft/pylance-release/issues/4882)
(`stubPath` changes not taking effect) and
[microsoft/pylance-release#2072](https://github.com/microsoft/pylance-release/issues/2072)
(the language server getting "stuck" on stale analysis, needing an explicit
restart) — both fetched 2026-09-15. **Design implication**: "refresh
environment" must say, every time, that a window reload (or "Developer:
Restart Language Server") is needed before Pylance reflects the change — it
can never promise an immediate result, matching the Runbook's 10b item.

**Finding 10.2 (2026-09-15) — a generated stub shadows a same-named package
that already resolves locally with real source, silently disabling real
type-checking for it.** Not one of the spike's own two planned questions —
found while designing the generator's scope. Method: a real local module
(`reallocalpkg.py`, one function `real_function(x: int) -> str`) alongside a
call passing a deliberately wrong argument type
(`real_function("a string, not an int")`); with no matching stub, `pyright`
correctly reports a type error; with a matching catch-all stub added at
`typings/reallocalpkg/__init__.pyi` under the same `stubPath`, the same
deliberately-wrong call reports **zero diagnostics** — the stub's own
permissive `__getattr__ -> Any` shape silently replaced the real, correctly
type-checked module. **Design implication**: the stub generator must not
stub every remote package unconditionally, contrary to this Plan section's
original prose — only 10a's `remoteOnly` diff bucket (or everything remote,
when the local environment itself is `local-unknown`, since nothing local
exists to shadow). Folded into the Runbook's stub-generator item, above,
rather than rewritten into the Plan section itself, per `CLAUDE.md`'s
"amend, don't rewrite the core plan" rule.

**Finding 10.3 (2026-09-15) — a real VS Code + Pylance reload did not clear a
`reportMissingImports` diagnostic for a newly-generated stub; the reload cost
itself is separately judged unacceptable.** Live manual test (Sean), not the
`pyright` CLI: with `babel` confirmed never previously stubbed in the test
workspace, uninstalling it locally produced `reportMissingImports`
immediately; **Refresh environment info** correctly left that diagnostic
unchanged (matching Finding 10.1's first half, re-confirmed against real
Pylance rather than only `pyright`). But completing the resulting "reload the
window" notice — a full extension-host restart, ~60–90 seconds, this
session's Viya connection dropped and requiring a manual reconnect — did
**not** clear or downgrade the diagnostic; `babel` still read
`reportMissingImports` afterward. Root cause not investigated this session,
at the developer's direction. **Not yet resolved** — full account, and the
developer's separate, standing objection to the reload cost itself
(independent of whether this turns out to be a distinct bug), in the
Runbook's "Manual test session, 2026-09-15" entry, above. This is a currently
open, unresolved finding, not a settled one — treat it as blocking for 10b
until either the diagnostic-clearing question or the reload-cost question (or
both) has a real answer.

If 10b's implementation turns up a further, genuine Viya-side surprise (for
example, whether an interpreter with an unusually large installed set makes
the existing Stage-2 probe's fixed byte cap, `MAX_ENVIRONMENT_PROBE_BYTES`,
worth revisiting now that the payload is growing an import-name list per
package — untouched so far, but newly adjacent to this phase's own
probe-payload widening), that would be Finding 10.4.

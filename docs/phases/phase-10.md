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

☐ **10b spike — run this first, before any other item in this phase.**

- ☐ In a real VS Code window with this extension (or a stand-in fixture) and
  Pylance installed, hand-write one generated stub package under
  `typings/`, point `python.analysis.stubPath` at it, and confirm an import
  that was `reportMissingImports` becomes `reportMissingModuleSource` (or
  clean) without a reload.
- ☐ Separately confirm whether *regenerating* the stub tree under an
  unchanged `stubPath`, after a "refresh environment" action, is picked up
  live or needs a reload — this decides whether "refresh" can promise an
  immediate result or has to say "reload the window to see updated
  environment information."
- ☐ Record both answers here, dated, as this phase's first probe-shaped
  finding even though neither is a Viya wire fact (Probe findings section,
  below, explains why that's still the right place for it).

☐ **10a — Environment view: search/filtering + local/remote diff.**

- ☐ Local dist-info reader: given a `sysPrefix` (from
  `@vscode/python-extension`'s `resolveEnvironment`), enumerate
  `site-packages`/`Lib\site-packages`'s `*.dist-info`/`*.egg-info` entries and
  parse each `METADATA`'s `Name`/`Version` — fixture-driven, no real local
  Python required to test it.
- ☐ Diff logic: remote packages (already in `RuntimeCapabilities`) vs. local
  (above) → three buckets (remote-only, local-only, version-mismatched);
  degrades to "local unknown" when `ms-python.python` is absent or has no
  active environment, never a hard failure.
- ☐ `Python on Viya: Search environment` — a new `QuickPick`-based command
  with built-in filter-as-you-type, additive to (not replacing) `Show
  environment`'s existing plain-text document (Plan, above — 3e's own
  rationale for a plain-text document still stands for the "read the whole
  thing" case).
- ☐ Extend `environmentDocument.ts`'s rendered text with a diff section,
  reusing `environmentStore.ts`'s existing cache — no new persistence needed
  beyond what the local read produces on demand.

☐ **10b — Pylance environment reflection (after the spike above).**

- ☐ Stub-tree generator: one `typings/<name>/__init__.pyi` per remote
  package, a permissive catch-all module stub (Plan, above) — pure function,
  fixture-driven.
- ☐ Workspace-settings writer for `python.analysis.stubPath`: read-modify-merge-write,
  never a blind overwrite of the user's own `settings.json` — a fixture
  asserting an unrelated existing key survives untouched is the test that
  matters most here.
- ☐ Wire "refresh environment" to regenerate the stub tree and, if the spike
  above found a reload is needed, say so plainly in the command's own
  result message rather than silently leaving stale diagnostics.
- ☐ Document the optional Python Environments extension
  (`ms-python.vscode-python-envs`) registration as a possible follow-on
  enhancement, not a dependency this phase requires (Plan, above) — a short
  `docs/` note, not code, unless a later session decides to build it.

---

## Probe findings

**No live-Viya probe was run this session, deliberately, not by oversight** —
the same reasoning Phase 9's scoping session gave for its own phase. Every
open question this phase raises is either already-settled Viya behaviour
(the Stage-2 probe's own wire shape, settled in Phase 3e and untouched here)
or a **VS Code/Pylance client-side** question — whether a generated
`stubPath` is picked up live, whether a workspace-settings write needs a
merge, whether the newer Python Environments extension's registration API is
worth using. None of those is answered by `viya-api-probe`; the one genuine
unknown among them (10b's spike, Runbook above) needs a hands-on VS Code
session with Pylance running, not a Viya deployment, and this scoping
session's sandbox has neither an interactive editor nor a reason to reach
Viya for it. If 10a's or 10b's implementation turns up a genuine Viya-side
surprise (for example, whether an interpreter with an unusually large
installed set makes the existing Stage-2 probe's fixed byte cap,
`MAX_ENVIRONMENT_PROBE_BYTES`, worth revisiting — untouched by this phase,
but adjacent to it), that would be the first probe recorded here, continuing
this project's global finding numbering from Finding 92 (`phase-8.md`).

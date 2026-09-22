# Phase 11 — Remaining parity gaps

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 11 — Remaining parity gaps

The long tail that Phases 6–10 don't cover (§3.1): session startup/autoexec
configuration, result panel styling options, snippets for common Viya patterns,
and any localisation bundles beyond English. Individually small, collectively the
difference between "works" and "feels like a peer of the SAS extension."
*Slices sized when the phase is reached.*

**Priority order set 2026-09-16 (Sean's own call), sized and sequenced into
slices 2026-09-16/17 once the phase was actually picked up:**

1. **11a — F7, the interactive window.** Now grounded (see F7 below): the
   built-in VS Code Interactive Window surface is off-limits to a published
   extension regardless of the kernel question, so this slice builds a
   bespoke surface on top of Phase 9's already-shipped `NotebookController`
   infrastructure — an unsaved scratch notebook of this project's own
   `notebookType`, plus a "Run Selection/Line" command that creates or
   reuses one. A short spike (confirming the unsaved-notebook mechanism end
   to end) belongs at the start of this slice, not the open-ended kind
   Phase 9/10's spikes needed.
2. **11b — F9, the CAS/SWAT explicit SQL passthrough helper.** Probed and
   confirmed working against `verde` (Finding 11.2) ahead of sizing, so this
   slice starts from a settled mechanism rather than an open probe question.
   Ships as documentation plus, likely, a small inserted-snippet command
   (F9's own text below has the shape) — smaller than 8b was.
3. **11c — The three pre-release bugs (B1/B2/B3, below).** Folded into this
   phase alongside F7/F9 rather than held for a separate pass: all three are
   user-visible breakage in already-shipped trees (CAS/SAS Content/SAS
   Libraries), not new scope, and none needs its own design pass.
4. **11d — F2 + F3, CAS table properties and CSV export.** Folded in as a
   single slice: both are the same shape of gap (a `TableSource`/panel
   action Phase 7 built and Phase 8 never extended to CAS), sized together
   per F3's own note above.
5. **11e — Session startup/autoexec configuration**, from the long-tail list
   above. A prior 2026-09-16 scoping session had this tied with F7 for first
   priority in the phase; this session's own explicit re-prioritization named
   only F7 and F9 as the two to go first, so it's carried here rather than
   dropped — behind F7/F9/the bugs/F2+F3 rather than ahead of them, since
   nobody has asked to relitigate its priority relative to the newer
   candidates, but still inside this phase's scope rather than pushed out of
   it. **Unlike 11a–11d, this one has no fleshed-out design yet** — the long
   -tail sentence above is the only description this file has ever given it
   (what "session startup" should configure: an autoexec-equivalent SAS/Python
   snippet run automatically per new session, a workspace setting, or both).
   Needs its own short scoping pass at the start of the slice, the way F7 and
   F9 each got one across two 2026-09-16 sessions, before it's sized further.
6. **11f — Ship an Agent Skill**, per
   [ADR-0037](../adr/0037-ai-agent-integration-approach.md) and the
   2026-09-21 research memo
   ([`docs/research/ai-integration-2026-09-21.md`](../research/ai-integration-2026-09-21.md)).
   A `.claude/skills/python-on-viya/SKILL.md` teaching an agent (Claude Code or
   VS Code Copilot agent mode — both read `.claude/skills/` verbatim, per the
   memo's Finding 14) how this project's execution model actually behaves:
   upload-plus-`infile=` submission rather than inline `endsubmit;`, `SYSCC` as
   a session variable, the interpreter banner/`>>>` markers as inherent output
   rather than a defect (Finding 11.3), library/CAS naming, what the
   environment probe reports, and the existing command surface. No production
   code; added to Phase 11 by Sean's own 2026-09-22 call, folding in work the
   research memo itself suggested would otherwise warrant a new phase — see
   ADR-0037's "Alternatives considered" for that departure recorded explicitly.
7. **11g — Spike: an in-process MCP server reachable by an external Claude Code
   session**, per ADR-0037 (Option C). Exploratory only, not a commitment to
   build the feature: the narrow question is whether an external Claude Code
   CLI session can actually connect to a loopback HTTP MCP server run inside
   the extension host, with a token handed over out of band, and whether the
   server survives a VS Code window reload — neither is promised by any
   documentation (research memo, "What would have to be settled before any
   code", items 1–2). The spike's own outcome, recorded here once run, decides
   whether a real Option C build gets scoped as a later slice or the project
   falls back to Option B (`languageModelTools` over the existing pure
   adapters), which ADR-0037 holds pending exactly this result.
8. **11h — Spike: a Python startup snippet's submission mechanism and
   namespace survival.** Added 2026-09-22, at Sean's own call: the 11e
   follow-up below ("a Python startup snippet") could not be sized or
   decided without more insight into how it would actually work, so this
   slice investigates rather than builds. Exploratory only, no user-facing
   feature. Open questions to settle and record here: what submission path a
   startup snippet takes given ADR-0014 (all Python reaches the interpreter
   as an uploaded file via `infile=`, never inlined) — is it its own job run
   at session-create time, alongside `autoExec`'s SAS lines (11e), or
   something else; whether its effect (imports, variables) actually survives
   into the *first* real `Run File`/notebook-cell job the same way it
   already survives between two ordinary runs in one session (probably
   already implied by existing behaviour, but not specifically confirmed for
   a job submitted before any user code has run); and, the harder question,
   what **`proc python restart;`** (`RESTART_STATEMENT`,
   `src/backend/procPython.ts`) does to a startup snippet's effect — does
   **Reset Python Interpreter** silently drop it with nothing to tell the
   user their setup is gone (the same blind-failure shape 11e's own
   autoExec-error follow-up, above, was scoped to avoid), or does a reset
   need to re-run it automatically. The spike's outcome — recorded here once
   run — decides whether the startup-snippet follow-up gets sized into a
   real slice or stays parked.

Everything else in this file — F1, F6, F8, and the items carried in from
Phase 6/9/10 housekeeping — stays out of this phase's scope by Sean's own
2026-09-16 call (see the scoping-session note in the Runbook, below), not
because it was reconsidered and rejected. It remains here as this project's
own record of the backlog, for whichever future phase picks it up. **F10**
(below) was added a day later, 2026-09-17, after this scope was already
decided — same treatment: out of this phase's scope, recorded in detail so
the design isn't lost, explicitly not authorized for implementation until a
dedicated scoping session revisits it.

**Localisation bundles beyond English — decided against, 2026-09-22 (Sean's own
call).** Named in this phase's original one-liner above alongside session
startup, result panel styling, and snippets; unlike the other three it never
got a slice, and it now won't: this project is not supporting anything beyond
English at this point. Not a deferral to a later phase — a settled decision,
recorded here rather than silently dropped. `package.nls.json` and
`l10n/bundle.l10n.json` stay the only bundle; no other-locale work is a
candidate for this phase or a future one unless revisited.

**Result panel styling options — closed, 2026-09-22 (Sean's own call).** Also
named in the original one-liner, never scoped into 11a–11e, and never
elaborated anywhere in this project's history beyond that one phrase — no
ADR, design note, or linked issue exists for it. Closed rather than sized:
what it would plausibly have meant (matching the editor's theme — fonts,
colors, light/dark/high-contrast) is already true for free, since the panel's
own stylesheet reads `--vscode-font-family`, `--vscode-foreground`, and
similar theme variables directly
([`resultPanel.ts:477`](../../src/run/resultPanel.ts)), not a hand-picked
palette. No further candidate (font-size control, word-wrap toggle, output
truncation) had anything concrete behind it either. Not a future candidate
unless something specific comes up.

**New feature candidates (added 2026-09-16, from Sean's own post-Phase-10 usage
— not sized, not sequenced beyond the priority order above, and not yet
triaged against §3.1's parity table).**

- **F1 — A SQL-passthrough bridge for Python queries against SAS libnames.** A
  custom UI for setting up and maintaining SAS libname definitions from the
  extension, with Python calls against that library intercepted and rewritten
  as a database-passthrough query run over the existing SAS connection, its
  answer returned to Python. **Flagged, not scoped**: this is qualitatively
  different from every other candidate here — it needs its own UI surface (new
  webview or tree, unlike anything this project has built for *configuration*
  rather than *browsing*), a Python-side interception mechanism this project
  has never needed (today's model is "submit a whole program, capture its
  output," never "rewrite one call inside it before it runs"), and a design
  question about where the libname definitions themselves persist. Sean's own
  assessment ("probably extremely complicated") matches: this reads as an
  architecture-level candidate that may warrant its own phase and a dedicated
  scoping pass with a hands-on spike, not a Phase 11 slice sized alongside
  autoexec and snippets. Not decided here, per this project's own "treat
  architecture-level changes as a deliberate event" rule — surfaced for Sean
  to weigh against the rest of the backlog.
- **F2 — Table properties for CAS tables.** Phase 7c already built this for SAS
  library tables (`tablePropertiesPanel.ts`); Phase 8 never extended it to CAS.
  Likely a straightforward reuse of the existing static panel against
  `TableSource`'s CAS implementation, in the same spirit as Phase 8c's own
  data-viewer reuse ([ADR-0034](../adr/0034-table-source-abstraction.md)).
- **F3 — CSV export for CAS tables.** Same gap as F2, for `csvExportCommand.ts`
  instead of the properties panel — Phase 7c-iii shipped it for SAS library
  tables, Phase 8 never extended it to CAS. Likely the same shape of reuse as
  F2, and worth scoping together with it since both are "the CAS tree is
  missing a context-menu action the SAS Libraries tree already has."
- **F6 — A UI panel of common commands, so users don't have to remember the
  command palette.** A small view (Sean's own suggestion: under the CAS tree)
  surfacing frequently-used commands as clickable entries rather than requiring
  **Ctrl+Shift+P** and a remembered name. Needs a design pass on which commands
  earn a spot (connect/disconnect, show/refresh/search environment, insert CAS
  snippet, and run-file are the obvious candidates) before it's sized.
- **F7 — An interactive window, matching VS Code's normal Python experience.**
  **Grounding, not a design yet**: VS Code's own Python Interactive Window
  (`Shift+Enter` / "Run Selection/Line in Python Interactive Window") is not
  provided by `ms-python.python` itself — it is `ms-toolsai.jupyter`'s own
  feature, and it requires either a real Jupyter server or, for its lighter
  "Raw Kernel" mode, a local `ipykernel` reachable via ZeroMQ
  ([code.visualstudio.com/docs/python/jupyter-support-py](https://code.visualstudio.com/docs/python/jupyter-support-py),
  fetched 2026-09-16). That is a structurally different execution model from
  anything this project runs today, and depending on it would reintroduce
  exactly the local-Python dependency this project's own non-negotiable (§1)
  and Phase 9's own ipynb-native decision
  ([ADR-0024](../adr/0024-notebooks-are-ipynb-native.md)) both deliberately
  avoided — a Viya profile has no local kernel process to connect to.
  **A second, harder blocker found 2026-09-16 (web search): even setting the
  kernel question aside, the built-in Interactive Window surface itself is
  off-limits to a marketplace-published extension.** VS Code exposes it to
  extension code only via the `interactiveWindow` *proposed* API — a
  `vscode.notebooks.createNotebookController` registered against the core
  `interactive` notebook view type still requires `enabledApiProposals` in
  `package.json`, and per VS Code's own "Using Proposed API" documentation, an
  extension built against any proposed API cannot be published
  ([code.visualstudio.com/api/advanced-topics/using-proposed-api](https://code.visualstudio.com/api/advanced-topics/using-proposed-api),
  [microsoft/vscode wiki, "Interactive Window Documentation"](https://github.com/microsoft/vscode/wiki/Interactive-Window-Documentation),
  fetched 2026-09-16). This is decisive on its own, independent of the
  kernel/execution-model question above: this project cannot integrate with
  VS Code's actual Interactive Window at all and ship on the Marketplace, so
  "matching VS Code's normal Python experience" can only ever mean *matching
  its user-facing shape*, never reusing its surface.
  **The shape this settles on, by analogy with Phase 9 and now considerably
  cheaper than first estimated**: this project already owns a fully-built
  ipynb-native `NotebookController` (Phase 9) against the profile's own
  compute session, with sanitized rich output and Problems-panel diagnostics
  — all stable, publishable APIs, because a *custom* `notebookType` (this
  project's own, not the core `interactive` one) has none of the proposed-API
  restriction. `vscode.workspace.openNotebookDocument(viewType, content)`
  creates an **unsaved, in-memory** notebook of that type — the same
  mechanism behind VS Code's own "Untitled-1.ipynb" — with no new execution
  machinery needed at all. The likely net-new work is then narrow: a command
  that opens (or reuses, if one is already open) such a scratch notebook, and
  a "Run Selection/Line" command, bound from a `.py` editor, that appends the
  selected text as a new cell to that scratch notebook and executes it —
  giving the interactive window's user-facing shape (persistent history,
  incremental execution, rich output) by riding entirely on Phase 9's already
  -shipped infrastructure rather than building a new one. **Still not a full
  design**: exact command names/keybindings, what happens with multiple
  scratch notebooks or multiple profiles open at once, and whether a
  hands-on spike is still warranted (probably a short one, to confirm the
  unsaved-notebook-of-a-custom-type mechanism behaves as expected end to end
  — not the open-ended kind Phase 9's 9a or Phase 10's 10b spikes needed,
  since the execution model itself is no longer in question) belong at the
  start of the slice, not decided here.
- **F8 — Interactive, sortable pandas DataFrame display**, distinct from the
  existing SAS/CAS table data viewer (Phase 7b, Phase 8c) — this is about a
  DataFrame value produced *during a run or in a notebook cell*, not a table
  browsed from a tree. Sean's own proposed default cap: 100 rows and 20
  columns, configurable. Likely reuses the existing React/ag-grid machinery
  ([ADR-0028](../adr/0028-data-viewer-is-react-and-ag-grid.md)) as a rendering
  target rather than building a new grid, but the cap, the trigger (every
  DataFrame result, or an opt-in action), and how this interacts with the
  Result panel's existing `RichOutput[]` shape are all open.
- **F9 — CAS/SWAT explicit SQL passthrough helper** (added 2026-09-16, from a
  separate conversation with Sean; **prioritized behind F7**, per the
  priority-order note above). A documented pattern (and possibly a small
  inserted-snippet command) for running native SQL directly against a
  caslib's own external-database connection via CAS's FedSQL explicit
  pass-through — `CONNECTION TO <engine> (...)`, available in FedSQL/CAS since
  Viya 3.4 per SAS's own documentation, so no dialect-layer branching is
  needed on that account — so a table's rows never have to load into CAS
  memory before a user can query them. From SWAT this is one CAS action call:

  ```python
  conn.loadactionset("fedsql")
  result = conn.fedsql.execDirect(
      query="select ... from connection to snowflake ( ... native SQL ... )"
  )
  df = result["Result Set"]  # already a SASDataFrame / pandas.DataFrame
  ```

  Nothing is written to CAS memory unless a `casout=` is also given. **Smaller than 8b
  was, not bigger**: the caslib already owns the credential to the external
  database (configured by whoever defined the caslib), so there is no new
  credential surface — this sits directly on top of the existing
  `pythonOnViya.insertCasConnectionSnippet` (Phase 8b) connection, reusing its
  token-delivery and reconnect-on-auth-failure story unchanged. **Finding
  11.1** first suggested at least one Snowflake-backed caslib was reachable,
  through a mechanism separate from and weaker than this project's own
  `viya-api-probe`/`verde` evidence. **Probed and confirmed directly against
  `verde` itself, 2026-09-16/17, with Sean's explicit go-ahead for the
  execute-shaped step — see Finding 11.2.** `fedsql.execDirect`/`CONNECTION
  TO` against `SNOWLIB`, a real Snowflake-backed caslib on `verde`, round
  -trips a native Snowflake query's result cleanly through the exact
  connection shape `buildCasConnectSnippet` already generates for Phase 8b.
  One behavioural note worth carrying into F9's eventual documentation: an
  explicit pass-through query runs single-threaded CAS-side regardless of
  server size (`numReadNodes=1`, forced — Finding 11.2). **Still open**:
  behaviour against a non-Snowflake connector type, and how a large result
  set behaves — neither exercised by this probe; a full design/slice for F9
  should treat those as untested, not assume they generalize. **Distinct from
  F1**: F1 intercepts arbitrary Python/pandas calls and rewrites them into
  passthrough SQL against a SAS *libname* — architecture-level, "probably
  extremely complicated" by Sean's own assessment. F9 has no interception at
  all: the user writes their own native SQL, the same way they already write
  `SAS.submit("proc sql; ...")` today (Phase 7d's own documented pattern).
  Ships either docs-only (7d's shape) or as a real snippet command (8b's
  shape) — not decided.
- **F10 — Auto-display of a notebook cell's rich output, matching a real
  Jupyter kernel, instead of requiring an explicit `savefig`/`to_html` file
  write.** Added 2026-09-17, after 11a's own manual-test pass (item 11.2 in
  `docs/dev/manual-tests/phase-11.md`) surfaced that `plt.show()` and a bare
  `df.head()` as a cell's last line both produce nothing — expected, current
  behaviour per [ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)
  and documented in `docs/notebooks.md`'s "Output" section, but a real
  usability gap for the exploratory, plot-as-you-go workflow notebooks exist
  for at all: today, *any* plotting library that doesn't get an explicit
  `fig.savefig(...)` call — including one that manages its own figures
  without the user ever calling `plt.show()` — produces no output at all,
  not just the `plt.show()` case.
  **This candidate is deliberately unscoped and undecided — Sean's own
  explicit call, 2026-09-17: this needs its own dedicated look, is not
  something to decide in the middle of another slice, and nothing here is
  authorization to implement any of it.** Recorded now, in this much detail,
  specifically so the design that came out of that session's discussion
  isn't lost before whoever picks this up next revisits it.

  **The mechanism discussed, sketched at the level a future scoping session
  would need to pick it up, not at implementation-ready detail:**
  1. The cell's own text still uploads exactly as it does today — byte-exact,
     unmodified, its own file. Nothing about *that* transfer changes.
  2. A small, fixed, project-owned "cell runner" Python script — never
     containing any user bytes, uploaded once per compute session rather than
     inlined per cell — reads the cell's file, `ast.parse`s it, and splits
     off the **last top-level statement** if (and only if) it is a bare
     expression. Everything before it still runs with plain `exec()`; the
     last expression, if there is one, is `eval`'d instead of discarded and
     handed to a display step — the same split a real interactive Python
     shell (`code.InteractiveInterpreter`/IPython's own `run_cell`) already
     does, reimplemented here because `PROC PYTHON infile=` has no
     interactive mode of its own (ADR-0014 finding 34's option enumeration —
     `COMMAND, ECHO, INFILE, RESTART, SRC, TERMINATE, TIMEOUT` — has nothing
     resembling one).
  3. **At the end of every cell, unconditionally** — not gated on a
     `plt.show()` call — the runner walks `matplotlib.pyplot.get_fignums()`,
     saves every currently open figure to a uniquely-named `.png` in the
     working directory, and closes it. This is the piece that actually
     answers "ALL plotting won't work": it doesn't matter whether the code
     called `show()`, called nothing, or used a library that manages its own
     figures — anything left open when the cell finishes gets captured,
     matching how Jupyter's own inline backend behaves (it doesn't hook
     `show()` either; it flushes open figures as a post-execution step).
  4. The display step (both for the trailing-expression case and for the
     figure-flush case) should probably speak the general IPython display
     protocol (`_repr_html_`/`_repr_png_`/`_repr_svg_`) rather than
     hand-coding "pandas and matplotlib" as two special cases — cheap
     additional reach, since several other libraries (Plotly, PIL, sympy)
     already implement it.
  5. Nothing about how output actually leaves the session changes — the
     runner only ever *writes files*; ADR-0019's existing
     working-directory-diff capture picks them up completely unchanged. No
     change to `RichOutput`, the transport, or `richOutput.ts`.

  **A tempting shortcut was probed and ruled out, not left unasked**: Finding
  74/93's `>>>` REPL-prompt markers raised the question of whether the
  embedded interpreter might already be running interactively enough to echo
  a bare expression's value into the log somewhere unfiltered — which would
  have meant reading the log differently instead of building the driver
  above. **Finding 11.3** probed this directly against `verde` and found no:
  the `>>>` prompt is cosmetic; neither test value ever appears anywhere in
  either job's log. The driver-and-eval mechanism above is the only path to
  this behaviour, not one option among several.

  **Why this cannot be scoped as an ordinary slice — it means amending
  ADR-0014, not working around it.** ADR-0014 states, project-wide, that
  "the bytes the editor holds are the bytes the interpreter reads, with
  nothing in between that tokenises, escapes, or re-encodes them" and that a
  `submit(code: string)`-shaped seam is foreclosed — restated in ADR-0019's
  own "Constrained by" line as "nothing may wrap or inject code around a
  user's own script." The mechanism above composes what actually reaches the
  interpreter (the cell's own file, run *through* a driver, rather than run
  directly) — exactly the shape that invariant currently forecloses,
  project-wide, with no carve-out for notebooks today.
  **Scoped narrowly, if it is ever done**: only the notebook/interactive
  -window execution path would ever compose bytes this way — Run File and
  Run Selection have no "last expression" or "figures left open across a
  session" concept to begin with (a `.py` file runs top to bottom, once,
  fresh-namespace by default) and this candidate proposes no change to
  either.
  **A plausible case that this does not reopen finding 33's actual hazard**
  (a `SUBMIT`/`ENDSUBMIT` SAS-tokeniser hazard, from splicing untrusted text
  into a SAS statement): the user's code never gets embedded as a string
  literal anywhere under this sketch — it stays in its own untouched file,
  and the driver only ever reads it from disk and hands it to `compile()`,
  so there is no delimiter/escaping surface at all, at either the SAS or the
  Python level. **That is an argument for why it might be safe to revisit,
  not a decision that it is** — ADR-0014 is this project's own foundational,
  "load-bearing" record by its own header, and reopening it needs the
  developer's own explicit review, not an inference from this write-up.
  **Real secondary costs a future slice would have to actually solve, not
  just theorize about:** a traceback from inside the driver gains a new
  wrapper frame (`tracebackDiagnostics.ts` would need to learn to drop it,
  the same class of problem ADR-0014 already solved once for two `<stdin>`
  frames — finding 39 — not a new one); the driver's own helper names must
  never leak into the user's persistent cross-cell namespace
  (`environment.ts`'s own probe already solved this exact shape of problem —
  define-then-`del` inside one wrapping function — and the same discipline
  would need to carry over here); and captured figure/table filenames need a
  collision-safe naming policy now that the *extension*, not the user, picks
  them (today's same-name-same-size-is-invisible caveat, ADR-0019's own
  Consequences section, is easier to trip with machine-generated names than
  user-chosen ones unless this is handled deliberately).
  **Explicitly not decided, not sized, not sequenced — do not pick this up
  as an implementation task without a dedicated scoping session first,**
  the same "architecture-level changes are a deliberate event" rule this
  project applies everywhere else (`CLAUDE.md`). Related but distinct from
  **F8**, above: F8 is about routing a DataFrame value into the existing
  ag-grid data viewer; F10 is about the underlying execution-model change
  that would let *any* rich value display at all without an explicit file
  write — if F10 ever happens, it would likely become the mechanism that
  feeds F8's own trigger, rather than the two being unrelated.

**Bugs found pre-release (added 2026-09-16, from Sean's own hands-on use —
not yet triaged for whether they're fixed ahead of the next release or as the
start of this phase).**

- **B1 — No connection means no clear way back in.** When the Viya connection
  is down (a timed-out session, a dropped VPN), the CAS tree, SAS Content tree,
  and SAS Libraries tree all currently just go blank, with nothing on screen
  explaining why or offering a way to sign back in. Every one of these views
  should always show *something* — an explanatory state and a way to
  reconnect — never a silently empty tree.
- **B2 — A stale connection breaks the SAS Libraries tree with no way back
  except a full sign-out/sign-in cycle.** With a stale connection, the SAS
  Libraries tree goes blank with no connect button, and **Connect to Viya**
  itself is not offered in the command palette in that state — the only way
  out is **Disconnect** (a full sign-out) followed by signing in again. If
  re-authentication is genuinely required, the extension should say so
  directly rather than leaving the user to discover the sign-out/sign-in dance
  by trial and error.
- **B3 — The SAS Libraries table icon doesn't match the CAS tree's.** SAS
  Libraries currently shows tables with a generic `[ ]` icon; CAS tables use a
  purpose-built loaded/unloaded table icon (Phase 8,
  [`src/cas/casTree.ts`](../../src/cas/casTree.ts)). The SAS Libraries tree
  should use the same icon for visual consistency between the two table
  browsers.

**Also carried here (added 2026-09-10/11, from the Phase 6→7/8 housekeeping
checkpoint): three items deferred out of Phase 6 that never landed a home.**

- ~~Upload/download to local disk, deferred to Phase 11~~ — **retracted
  2026-09-11.** `phase-6.md` and `STATUS.md` previously said this was
  "deferred to Phase 11 (Sean, 2026-09-10)"; that attribution was never
  confirmed with him (a prior session's own scope call, per git blame on
  `c63feaf`), and Sean has said directly he does not want this pushed out
  this far — it is a feature developers will expect, not a long-tail parity
  item. **Not scoped here.** It needs uploading a local file into a SAS
  Content folder and downloading a SAS Content file to local disk — the two
  directions Phase 6's `sasContent:` `FileSystemProvider` and tree explicitly
  did not cover — but which phase it actually belongs to is Sean's call to
  make, not a repeat of the same mistake in the other direction.
- **Drag a folder/file onto My Favorites.** A drop onto the My Favorites
  delegate in the SAS Content tree already no-ops (`contentMove.ts`'s
  `moveObjection` returns `target-not-a-folder` for it) rather than doing
  anything; wiring it to `addToFavorites` instead is upstream parity that
  never made either 6d slice's punch list (`phase-6.md`'s 6d-i Runbook entry).
  Small, self-contained, no probe needed — the mutation it would call already
  exists.
- ~~Right-click Cut / Paste for SAS Content items~~ — **the Cut/Paste half is
  done**, shipped at the Phase 6→7/8 housekeeping checkpoint alongside a
  drag-and-drop fix attempt (`phase-6.md`'s 6e Runbook entry,
  [ADR-0032](../adr/0032-content-cut-paste.md)) — see below, the fix
  attempt did not work, and Cut/Paste is now the only working way to move
  an item in this tree, not merely the unambiguous one. Not an oversight
  relative to upstream: `vscode-sas-extension`'s own `ContentNavigator/index.ts`
  has no such command either, only drag-and-drop plus a `copyPath` command
  that copies a path string to the OS clipboard, not the item itself — a
  deliberate improvement over upstream, not a parity gap being closed.
- **Copy/Paste for SAS Content items — still open, deliberately not scoped
  with Cut.** `src/content/types.ts`'s relation constants
  (`self`/`up`/`members`/`addMember`/`update`/`deleteResource`/`delete`/
  `deleteRecursively`/`previousParent`/`validateRename`/`validateNewMemberName`)
  include nothing for a server-side copy — unlike Cut (which reuses the
  already-probed `ContentAdapter.moveItem`), whether the Folders/Files
  service supports copying a member at all is unprobed and needs a
  `viya-api-probe` pass, not an assumption, before this is designed. If
  there is no server-side copy, this means read-the-content-then-create-a-new-file,
  real additional work rather than a rename of Cut's call.
- ~~Drag-and-drop within the SAS Content tree remains completely
  non-functional — root cause unknown~~ — **closed 2026-09-11, fixed.** 6c-ii
  shipped it fully unit/integration-tested but never live-tested; the Phase
  6→7/8 housekeeping checkpoint's live pass (2026-09-11) found it did
  nothing at all — no progress notification, no error, no move — and an
  investigation (diagnostic logging, a throwaway isolation test extension, a
  live comparison against `vscode-sas-extension`'s own working
  `ContentDataProvider`) landed on a plausible but ultimately wrong cause (a
  folder `TreeItem` missing `resourceUri` —
  [ADR-0031](../adr/0031-content-folder-resource-uri.md)), confirmed wrong by
  a live retest after shipping that fix: identical symptoms, unchanged.
  That investigation correctly ruled out the installed `@types/vscode`/VS
  Code version, general Electron drag flakiness, the drag payload's
  MIME-type format, and nesting depth — but its own theory (that folders
  were somehow special) was itself the dead end; drag *engagement* was never
  the problem.
  **The one avenue that investigation never reached — VS Code's own
  Developer Tools console during a live drop — is exactly what found it.** A
  Phase 7 session (2026-09-11, VS Code 1.109 source) saw `ERR
  o.onCancellationRequested is not a function` at `handleDrop` in the
  console: `handleDrop`'s own `CancellationToken` argument is a non-final
  argument to `mainThreadTreeViews.ts`'s `$handleDrop`, so
  `rpcProtocol.ts`'s "pop a trailing cancellation token" marshalling never
  catches it, and it crosses the extension-host RPC boundary as plain JSON,
  which strips `MutableToken`'s prototype-getter
  `onCancellationRequested`. `handleDrop` had been firing and completing its
  own guard checks on every real attempt all along; it threw immediately
  afterward, before any move ran, whenever there was something movable to
  attempt — invisible in this extension's own output channel because the
  throw lands in the DevTools console instead. Fixed in
  `src/content/contentDragAndDrop.ts` (the `token` subscription is dropped;
  only `progressToken`, which never crosses RPC, is subscribed to) and
  recorded as finding 6.16 in `phase-6.md`, including a correction of that
  file's own "fires ~1 in 6" and "root cause unknown" claims and ADR-0031's
  second amendment. `npm run verify`/`test:integration`/`check:docs` all
  green, a new regression test reproduces the exact broken-token shape, and
  an adversarial pass before the push raised no blocking findings (the
  reviewer independently re-derived the VS Code source mechanism rather
  than taking the write-up's word for it). **Live-confirmed 2026-09-11
  (Sean)**: a real drag-and-drop move now works, plus every other §15 row
  that had been blocked on the base gesture (multi-item drag, the
  My-Favorites/Recycle-Bin no-ops, the self-drop no-op, multi-select
  hiding context actions) — see `manual-test-pass.md`'s §15. Cut/Paste
  (above) remains a permanent, working alternative regardless — this
  closes the parity gap, it does not replace Cut/Paste.

**Also carried here (added 2026-09-14, from Phase 9's 9b manual pass, §9.8):
real tracking of an interrupted cell's abandoned statement, for a precise
"waiting" message.** `notebookController.ts`'s `executeCell` gives a cell that
sits with no output for `WAITING_NOTICE_DELAY_MS` an honest, cause-agnostic
notice rather than silence — deliberately not a claim that a previous,
interrupted statement is still finishing server-side, because the client has
no way to know that (Finding 76: an interrupt's local abort clears
`backend.busy` well before the SAS-side statement it interrupted actually
ends, and nothing keeps a reference to that abandoned statement afterward).
Building real tracking of it — enough to word the message precisely — is what
Phase 4c already declined once for Run File's own identical gap, as
disproportionate for that slice. Worth a harder look here: revisit whether a
lightweight version (a session-scoped "last interrupted, not yet confirmed
free" flag, cleared the next time a submission into that session succeeds)
is now proportionate, now that notebooks make the scenario more common than
Run File alone did. Not scoped as a slice yet — a candidate, not a commitment.

**Also carried here (added 2026-09-15, at the Phase 9→10 housekeeping
checkpoint — should have landed with 9c's own merge but was missed until this
checkpoint caught the gap between what `phase-9.md` claimed was carried and
what actually was): two more Phase 9c gaps, both explicitly deferred rather
than fixed.**

- **A rejected `appendOutput` mid-stream skips `execution.end`.** If a
  notebook is closed while a cell is still running, `notebookController.ts`'s
  in-flight `execution.appendOutput(...)` calls reject, and nothing calls
  `execution.end(...)` afterward — pre-existing since 9b, noted but not fixed
  by 9c's own adversarial review (Finding 10, `phase-9.md`'s 9c Runbook
  entry) since the failure mode is a closed notebook, not a live one a user
  is still looking at.
- **A stale Problems-panel entry for a notebook cell can outlive a sign-out.**
  9c's own adversarial review (Finding 2) fixed the closed-notebook half of
  this gap (`handleNotebookClosed`, wired to
  `workspace.onDidCloseNotebookDocument`) but left the sign-out half open
  deliberately — `RunDiagnostics.onDidSignOut`/`onDidCloseTextDocument`
  clearing hooks (Phase 5d-iv) have no notebook equivalent to hook into, and
  threading `onDidSignOut` through `extension.ts` a second time for a surface
  a person will, in the ordinary case, just re-run was judged not worth it
  that slice — the same "disproportionate" call Phase 4c made for Run File's
  own comparably narrow waiting-cell-message gap. Worth revisiting alongside
  the item above, since both are instances of the same shape: an execution
  surface's terminal state going stale when the surface itself goes away
  mid-run or post-run.

**Closed 2026-09-15, before Phase 11 started: the CAS tree icon-flip gap
(carried here 2026-09-14 from Phase 8's own post-merge fixes) is fixed and
live-confirmed.** Root cause: `onDidChangeTreeData` resolves a fired element
through `ExtHostTreeView`'s `_nodes: Map<T, TreeNode>`, keyed by the
extension's own **object** — `TreeItem.id` is never used to look a node up —
so the state-updated *copy* PR #173 fired was discarded with no error, which
is why that fix passed every test and did nothing live. `src/cas/casTree.ts`
now fires the identical element and carries the new state out-of-band in a
`loadedTables` set that `getTreeItem` overlays. Full account, including why
no test of the original could have caught it:
[`phase-8.md`](phase-8.md)'s "Icon-flip gap: root cause found, 2026-09-15"
Runbook entry; manual-test item 8.28 passes. **No Phase 11 work remains
here** — kept as a one-paragraph record rather than deleted outright, so a
session that arrives via the 2026-09-14 cross-references does not go looking
for an item that is no longer in this list.

**Also carried here (added 2026-09-15, from Phase 10b's pre-push adversarial
review — two items discussed with the developer and deferred rather than
built, `phase-10.md`'s "Adversarial self-review, 2026-09-15" Runbook entry
has the full discussion).**

- **A `pythonOnViya.*` setting to opt out of Pylance stub generation.** 10b
  (`docs/python-environment.md`#quieting-pylances-false-unresolved-import-warnings)
  writes a generated stub tree into the workspace and edits
  `python.analysis.stubPath` on every fresh probe, with no way to turn it
  off. Nobody has asked for one yet, and it's a real if bounded addition — a
  new `package.json` configuration contribution plus wiring
  (`src/run/pylanceStubSync.ts`) and a documentation update. A candidate for
  whenever it is actually requested, not scoped as a slice yet.
- **Closed on the 10b branch itself, before this item ever reached Phase
  11.** A PR #182 review round found the gap was not only a multi-root
  concern as first scoped here — `stubPathSetting.ts`'s `decideStubPathAction`
  only checked `workspaceValue`, which missed a `stubPath` set at *user/global*
  scope even in the ordinary single-folder case, silently overriding it. Fixed
  in `c81f9d5`: `decideStubPathAction` now takes `globalValue`,
  `workspaceValue`, and `workspaceFolderValue` together, honouring VS Code's
  own scope precedence. Kept as a one-paragraph record rather than deleted
  outright, for the same reason the CAS tree icon-flip entry above is.

**Also carried here (added 2026-09-09, from the Phase 5→6 manual test pass):
Accounts-menu legibility.** With two profiles signed in whose auth flows differ,
VS Code shows two separate rows (it only collapses profiles that produce the
*same* `account.label` —
[#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42)), but the rows carry
no indication that they belong to **Python on Viya** or which profile each is —
one appeared as `Sean Ford (SAS Viya)`, the other as `sean.ford@sas.com
(Microsoft)`, the parenthetical being the auth provider's own name. Scope for a
slice here: give `ViyaAuthenticationProvider`'s session `account.label` (and, if
possible, the row's provider-facing name) a form that identifies the extension
and the profile — and settle the `(Microsoft)`-vs-`(SAS Viya)` inconsistency for
a corporate-creds profile. Related: `#42` itself (the same-label collapse) and
RUNBOOK item 146.

**Resolved 2026-09-22, by decision rather than by code: documented as a known
limitation instead of fixed.** `AUTH_PROVIDER_ID`/`authProviderLabel()`
(`src/auth/authProvider.ts`) show this extension registers exactly one
authentication provider, labeled `SAS Viya` — so every row it adds already
reads `<name> (SAS Viya)`. On that evidence the `(Microsoft)`-labeled row in
the original 2026-09-09 observation was not a row this extension produced, and
the paragraph above overstates what was established; left as its own record
rather than rewritten, per this project's own practice of not deleting a
superseded note outright. The real, still-open gap is narrower: two profiles
for different deployments can show the identical `<name> (SAS Viya)` row, with
nothing distinguishing which profile signed in as which. Sean's call: not
worth a code change before 1.0 — a per-session label would need more than
`#42`'s own display-name-collapse fix touches, for a menu most users glance at
rather than rely on. Documented instead in `docs/signing-in.md`'s "More than
one deployment at once" section. Closes this gap's §8 1.0 gate as a documented
known limitation rather than a fix — see `STATUS.md`.


---

## Runbook

### Phase 11 scoping session, 2026-09-16/17

Phase 10→11 housekeeping had already closed (`STATUS.md`); this session
picked the phase up per Sean's own instruction to prioritize F7 (interactive
window) and F9 (SQL passthrough helper) first, then fold in whatever else
reasonably fits alongside them. Work done this session, all in the Plan
section above unless noted:

- **F7 grounded, not just re-described.** Web search confirmed a second,
  independent blocker beyond the kernel/execution-model question the phase
  file already carried: VS Code's built-in Interactive Window surface is
  reachable from extension code only through the `interactiveWindow`
  *proposed* API, and an extension using any proposed API cannot be
  published to the Marketplace. This settles the design direction — a
  bespoke surface reusing Phase 9's already-shipped `NotebookController`
  infrastructure via an unsaved scratch notebook of this project's own
  `notebookType` — considerably cheaper than the phase file's prior "likely
  shape, not decided" framing suggested, since no new execution machinery is
  needed, only two new commands.
- **F9 probed and confirmed** via `viya-api-probe` against `verde`, with
  Sean's explicit go-ahead for the one execute-shaped step (a compute-session
  `fedsql.execDirect` call). See **Finding 11.2** below for the full account,
  including a caslib-detail-vs-collection-listing wrinkle worth knowing and a
  forced-single-node-read behavioural note worth documenting alongside F9
  when it ships. Two throwaway CAS sessions (one `casManagement`, one
  compute) were created for the probe and both confirmed deleted
  (`404` on read-back) before this session moved on.
- **Scope for the phase decided with Sean (`AskUserQuestion`):** F7, F9, the
  three pre-release bugs (B1/B2/B3), and F2+F3 (CAS table properties/CSV
  export) all ride together in this phase; F1, F6, F8, and the
  Phase-6/9/10-carried items stay out, not because they were reconsidered,
  but because they weren't asked for and several need their own design pass
  first. Session startup/autoexec configuration — tied for first priority
  with F7 in an earlier same-day session, per the Plan section's own note —
  is kept in scope as **11e**, sequenced behind the four items actually named
  this session, since dropping it silently would have contradicted that
  earlier priority call.
- **Punch list below sizes five slices** (11a–11e) in priority order. None
  has started; sizing is a scoping estimate, not a commitment, per this
  project's own "slices sized when the phase is reached" rule — now that it
  has been.

### Punch list

- [x] **11a — Interactive window (F7).** Code and automated tests done, one
  pre-push adversarial review completed and every finding folded in locally,
  pushed as [PR #192](https://github.com/Shai-Alit/sas-py-vscode/pull/192);
  **manual-test items 11.1–11.5 (`docs/dev/manual-tests/phase-11.md`) all
  pass**, 2026-09-17 — 11.2's own rich-output row needed a corrected repro
  first (see this section's own Runbook entry, below). See that entry,
  below, for what shipped and what did not (the no-connection case in
  particular — carried to 11c/B1, not built here) and for the review-fix
  entry covering what the first review round found.
- [x] **11b — CAS/SWAT SQL passthrough helper (F9).** Shipped as
  documentation (`docs/cas-python-connection.md`'s new "Running native SQL
  against an external database" section) plus a small inserted-snippet
  command, `pythonOnViya.insertCasSqlPassthroughSnippet` — decided worth
  building once drafting the doc made clear the template itself needed no
  network round trip at all, unlike 8b's own command. Documents the forced
  single-node-read behaviour (Finding 11.2) as an expectation. See this
  section's own Runbook entry, below, for what shipped and the design calls
  made while drafting.
- [x] **11c — Pre-release bug fixes (B1/B2/B3).** B1: a new
  `ConnectionProblemNode` (`src/connectionProblemNode.ts`) each of the three
  trees' `getChildren` now returns on a failed listing instead of `[]`. B2:
  `SasLibraryTreeProvider` and `casConnectCommand.ts` (extended mid-session,
  Sean's own report) now call `forgetProfile` on a `session-gone` reading, so
  **Connect to Viya** reappears in the palette without needing **Disconnect**
  first. B3: `src/data/presentation.ts`'s table icon changed to `"table"`,
  matching CAS's loaded-table icon. B1 and B2 turned out not to share one
  mechanism — see this section's own Runbook entry, below, for why and for
  what shipped.
- [x] **11d — CAS table properties + CSV export (F2 + F3).** Code, automated
  tests, docs, and manual-test items 11.15–11.22
  (`docs/dev/manual-tests/phase-11.md`) written; pre-PR adversarial review
  (no blocking findings) and the manual pass (all items pass, 2026-09-20)
  done. Both existing
  surfaces were generalised behind a small per-backend source
  (`PropertiesSource`, `CsvExportSource`) rather than forked; see this
  section's own Runbook entry, below.
- [ ] **11d follow-up — large-table confirmation for SAS library tables.**
  Added 2026-09-19 at Sean's request. CAS export now asks for confirmation
  above an estimated 100 MB (`CsvExportSource.confirmAboveBytes`, 11d);
  `LibraryCsvSource` sets no threshold, so a SAS library table's export never
  asks. Do the same there: choose a threshold, probe how a large Compute
  session table pages (Finding 7.20 measured only `SASHELP.CLASS`; nothing
  larger has been exported), set `confirmAboveBytes` on `LibraryCsvSource`,
  and add manual-test items mirroring 11.19/11.20. **Decided 2026-09-22
  (Sean): build it.**
- [ ] **11d follow-up — a `CasProblem` for an oversized response.** Added
  2026-09-20 from the PR #197 review. `src/cas/client.ts` has no
  `ResponseTooLargeError` case, so a CAS page over the transport's 1 MiB cap
  (a very wide table's export or grid page) surfaces as `cas-unreachable` —
  proxy troubleshooting advice, with the real cause only in the detail.
  Mirror `content-too-large` (`src/content/client.ts`, `problems.ts`,
  `messages.ts`): a dedicated variant carrying the cap, a message saying the
  table/page is too wide, and a test driving a real `ResponseTooLargeError`
  through `CasClient`. Then restore `docs/browsing-cas.md`'s "content too
  large" wording and the two comments corrected in 11d (`csvFormat.ts`,
  `csvExportModel.ts`). Consider the same for the Compute/library client.
  **Decided 2026-09-22 (Sean): build it.**
- [ ] **11d follow-up — opt-in CSV formula-injection guard (CAS).** Added
  2026-09-20 from the PR #197 review. A text cell beginning `=`, `+`, `-` or
  `@` is written as-is (documented in the two export sections for now). Idea:
  a setting, default **off**, that prefixes such cells in character columns
  only, in `formatCsvPage` (`src/cas/csvFormat.ts`); numerics stay untouched.
  Off by default because the standard `'` prefix alters data (`-Bob` reads back
  as `'-Bob` in pandas). The SAS library path relays the server's CSV
  untouched (Finding 7.20), so guarding it means re-parsing every page — a
  separate decision, not part of this item. **Decided 2026-09-22 (Sean):
  build it, off by default as scoped above.**
- [x] **11e — Session startup/autoexec configuration.** Scoped 2026-09-20 to
  profile-level `sasOptions` + `autoExec` (SAS lines, inline or file), mirroring
  upstream; code, unit and integration tests, docs and manual-test items
  11.23–11.28 written. Also fixes `PAGESIZE=MAX` never having been applied
  (Finding 11.7). Pre-PR adversarial reviews done 2026-09-21 (first: one finding;
  second, after manual testing and Finding 11.8: six findings, folded in);
  manual-test items 11.23–11.28 all passed 2026-09-21 (11.26 after a re-run
  following the Finding 11.8 fix).
  See this section's own Runbook entry, below.
- [ ] **11e follow-up — show the text of an autoExec error.** Added 2026-09-20.
  A bad line leaves the session `idle` with `sessionConditionCode` 3000 and the
  `ERROR` only in the session log (Finding 11.7). Read
  `/compute/sessions/{id}/log` after create when the code is nonzero and write
  the `ERROR`/`WARNING` lines to the output channel. **Decided 2026-09-22
  (Sean): build it — never show a blind warning with nothing to help the user
  fix it.**
- [ ] **11e follow-up — a Python startup snippet.** Added 2026-09-20; out of
  11e by decision. Needs its own submission per session and an answer to
  ADR-0014 and to `restart`/namespace lifetime before it is sized. **Sean,
  2026-09-22: cannot be decided yet — investigate first.** See 11h, below.
- [ ] **11f — Ship an Agent Skill (Option A).** Scoped 2026-09-22
  (ADR-0037). `.claude/skills/python-on-viya/SKILL.md`, documented as
  copyable to `~/.claude/skills/`; no production code. See this section's
  own Runbook entry, below, once written.
- [ ] **11g — Spike: in-process MCP server reachable by Claude Code (Option
  C).** Scoped 2026-09-22 (ADR-0037). Exploratory: settles whether an
  external Claude Code session can connect to a loopback HTTP MCP server run
  by the extension host and survive a window reload. Outcome recorded in
  this section's own Runbook entry once run; decides whether a real build
  gets scoped next or the project falls back to Option B.
- [ ] **11h — Spike: a Python startup snippet's submission mechanism and
  namespace survival.** Added 2026-09-22, at Sean's own call, to inform the
  11e follow-up above rather than build it directly. Settles the submission
  path given ADR-0014, whether the snippet's effect survives into the first
  real run, and what `proc python restart;` does to it. Outcome recorded in
  this section's own Runbook entry once run; decides whether the
  startup-snippet follow-up gets sized into a real slice or stays parked.

### 11a — Interactive window

The short spike this slice's own punch-list entry called for turned out to
already be settled: `controller.test.ts`'s 9a regression already proves an
unsaved, in-memory notebook of `NOTEBOOK_TYPE` (`jupyter-notebook`, ADR-0024
— not a custom type; this module's own doc comment and the Plan section
above both originally assumed one would be needed, and neither was) opens
and executes end to end via the real, activation-registered
`NotebookController`, with no Jupyter extension installed. No new spike test
was written; that existing one already carries the claim.

**What shipped**, all in `src/notebook/interactiveWindow.ts`: two commands,
`pythonOnViya.openInteractiveWindow` and
`pythonOnViya.runSelectionInInteractiveWindow`, wired into
`extension.ts` against the real `NotebookController`
`registerNotebookController` already builds. A single module-scoped tracked
notebook (re-created if closed) rather than a registry of many — nothing
asked for more than one at a time. Kernel selection after creating a fresh
notebook is asynchronous; rather than a fixed delay or a poll loop (the
shape `controller.test.ts`'s own 9a spike used), this waits on
`NotebookController.onDidChangeSelectedNotebooks` directly, bounded by a 10s
timeout, then attempts the run regardless — the same "worst case is a
one-time no-op" reasoning that spike's own retry loop relies on.

**Run Selection in Interactive Window deliberately does not fall back to the
current line** despite `phase-11.md`'s own "Run Selection/Line" phrasing
(itself borrowed from VS Code's real command name): `run/commands.ts`'s
`buildProgram` already decided, for the existing Run Selection command, that
an empty selection means nothing to run, with no current-line fallback.
Giving this command different behaviour for the same situation would be an
unrequested inconsistency between two "run selection" commands in one
extension, so it matches the existing one instead — a command that says what
it does ("Run Selection in Interactive Window") rather than promising a
fallback this project's own Run Selection has never had.

**Verification:** `npm run verify` green (1,814 unit tests; coverage
96.3/95.68/96.08/96.3 lines/branches/functions/statements, unchanged from
Phase 10's baseline — `interactiveWindow.ts` is `.c8rc.json`-excluded, the
unit tier cannot reach a module built entirely on `vscode`, the same rule
`notebookController.ts` was already excluded under). `npm run test:integration`
green (456 passing — 454 pre-existing plus two new, in
`test/integration/notebook/interactiveWindow.test.ts`), run via the
documented `ELECTRON_RUN_AS_NODE`-strip workaround this session rediscovered
the need for the hard way before remembering it was already recorded.
`npm run check:docs` green, including a new "The interactive window" section
in `docs/running-python.md`. Manual-test items 11.1–11.5
(`docs/dev/manual-tests/phase-11.md`) all pass, 2026-09-17 — see this
section's own "11a manual-test pass, 2026-09-17" Runbook entry, below, for
11.2's own rich-output detour.

**What this slice deliberately did not build**: the no-connection case the
original punch-list entry named. An interactive window with no active Viya
connection opens fine (an empty notebook is not "blank with no
explanation" — B1's own complaint is about a *tree* going silently empty,
which does not apply here); a cell run with no connection fails through
`notebookController.ts`'s own existing `backendCache.backendFor()` handling,
the same path every other notebook cell already goes through with no new
code needed. Nothing about *this* surface's own connection handling was
built or found lacking — 11c/B1's broader connection-state work, if it
changes that shared path, changes it for this surface too, for free.

**Pre-push adversarial review, round 1 (2026-09-16), all findings fixed
locally before any push.** Two blocking findings, four "should fix," several
minor:

- **Kernel-selection wait was effectively a fixed 10s delay on every run**,
  not the real signal the module's own doc comment claimed —
  `onDidChangeSelectedNotebooks` is edge-triggered, so a notebook already
  selected (every run after the first into the same window) has no further
  event to wait on, and the reviewer traced the new test's own
  `this.timeout(40_000)` bump to exactly two of these timeouts firing in the
  test host. **Fixed**: `registerInteractiveWindowCommands` now keeps one
  long-lived `onDidChangeSelectedNotebooks` subscription for the extension's
  whole lifetime, recording every notebook the controller has been selected
  for in a module-scoped `Set`; `waitForControllerSelection` returns
  immediately when the notebook is already in that set, and only a
  genuinely fresh selection pays the bounded wait. The set is cleared on
  deselection and on `onDidCloseNotebookDocument` so it cannot grow
  unbounded across repeated open/close cycles.
- **`notebook.cell.execute` was a single unguarded call**, unlike
  `controller.test.ts`'s own 9a spike, which loops past exactly this kind of
  transient kernel-resolution failure. **Fixed**: `executeCell` retries once
  after a short pause on rejection, and surfaces a friendly
  `showErrorMessage` if the retry also fails, rather than leaving VS Code's
  own raw command-failure notification as the only feedback.
- **The empty-selection/non-Python-editor guard was silent**, contradicting
  its own doc comment's claim to mirror `runSelection`'s convention — that
  command informs the user in both cases (`run/commands.ts`'s `runNow`).
  **Fixed**: both guards now call `showInformationMessage` with the exact
  same two strings `runNow` uses ("Open a Python file to run it on SAS
  Viya." / "Select some code to run."), and the empty-selection guard also
  now rejects a whitespace-only selection, matching `buildProgram`'s own
  `text.trim() === ""` check exactly (it previously checked `isEmpty` only).
  `docs/running-python.md` and manual-test item 11.4 updated to match —
  both previously described (or, for 11.4, expected) an actually-silent
  no-op.
- **`getOrCreateInteractiveWindow` had an await race**: two calls landing
  before the first `openNotebookDocument()` resolved could each create their
  own notebook, orphaning one. **Fixed**: the in-flight creation promise is
  now cached in a module-scoped variable and shared by any call that arrives
  while it is outstanding.
- **`applyEdit`'s boolean result was discarded**: a rejected edit (the
  tracked notebook closing between the `isClosed` check and the edit) would
  leave `notebook.cell.execute` targeting a cell range that was never
  inserted. **Fixed**: a failed edit now retries once against a freshly
  created notebook, and reports an error if that also fails, instead of
  silently doing nothing.
- **Three exports had no consumers** (`getOrCreateInteractiveWindow`,
  `openInteractiveWindow`, `runSelectionInInteractiveWindow`), and their own
  doc comments' claim that they were "exported for the integration test's
  own direct use" was false — `interactiveWindow.test.ts`'s own doc comment
  says the opposite, deliberately driving both commands through
  `vscode.commands.executeCommand` rather than importing these directly.
  **Fixed**: all three are no longer exported; only
  `registerInteractiveWindowCommands` is.
- **`reveal()` always opened `ViewColumn.Beside`**, which could open a
  second editor of the same notebook when invoked while some other column
  was already active. **Fixed**: `reveal` now checks
  `vscode.window.tabGroups` for a column the notebook is already visible in
  and reuses it, falling back to `Beside` only when it is not visible
  anywhere.
- **The context-menu entries for both commands were gated on
  `pythonOnViya.runTarget == viya`**, a condition neither command's own code
  ever checks — unlike Run File/Run Selection, which do gate on run target
  in `runNow` itself. With the run target set to Local Python, both entries
  vanished from the editor context menu while still working fine from the
  Command Palette (which carries no such gate) — a real inconsistency, not a
  deliberate design choice recorded anywhere. **Fixed**: the
  `pythonOnViya.runTarget == viya` clause is removed from both
  `editor/context` entries in `package.json`, so menu visibility now matches
  what the commands actually do.
- **Test gap**: "tracked notebook closed → a fresh one is created" was
  manual-test item 11.5 only. **Fixed**: added as a third automated case in
  `interactiveWindow.test.ts`.
- **Not changed, recorded as a deliberate call**: `activeTextEditor` being a
  focused cell inside the interactive window's own notebook (rather than the
  originating `.py` file) is left as-is — running the command in that state
  will append a cell from that cell's own selection, which is arguably
  reasonable REPL behaviour (re-running an earlier cell's code into a new
  one) rather than a bug, and building a special case for it would be new
  design, not a fix to something broken. Flagged for whoever revisits this
  surface, not solved here.
- **Not changed, recorded as a deliberate call**: this module has no
  unit-testable seam, unlike `notebookController.ts`/`run/commands.ts`,
  which both split a handlers factory out from registration specifically so
  ADR-0009's ".c8rc.json exclusion for vscode-only code" rule doesn't cost
  unit coverage. Everything here — the guards, the retry logic, the index
  arithmetic — is permanently outside the unit-coverage denominator,
  covered only by `interactiveWindow.test.ts`'s integration suite.
  Defensible at this module's size; not worth the extra indirection a
  handlers-factory split would add for two commands this small.

`npm run verify` green after these fixes (1,814 unit tests, coverage
unchanged at 96.3/95.68/96.08/96.3 — `interactiveWindow.ts` stays
`.c8rc.json`-excluded, so none of this fix set moves the unit-coverage
numbers). `npm run test:integration` green too, via the documented
`ELECTRON_RUN_AS_NODE`-strip workaround (457 passing — 454 pre-existing plus
the two original interactive-window tests plus the one new "closed → fresh
notebook" case), and the fix for the fixed-delay finding is directly visible
in the numbers: the existing two-selection test dropped from needing
`this.timeout(40_000)` (previously ~20s, two full kernel-selection timeouts)
to completing in ~10.2s on one, so its own `this.timeout` was tightened to
`20_000` to match. `npm run check:docs` green (VitePress build included).
No second review round was judged necessary: every finding was either fixed
exactly as recommended or is recorded above as a deliberate, narrow call,
and nothing in the fix set touches new surface the first review didn't
already cover.

**PR #192 review round (Codex + the Claude reviewer, 2026-09-17), all
should-fix findings fixed locally in one pass before the next push.** Both
reviewers independently flagged the same defect; the Claude reviewer's
independent pass also found one further race the first round's own
`creatingTracked` fix didn't extend to:

- **`getOrCreateInteractiveWindow` never recovered from a rejected
  `openNotebookDocument()` call** (Codex, major; Claude reviewer,
  correctness #1) — `creatingTracked` was cleared only on the success branch
  of `.then`, so a rejection (untitled-notebook creation failing, or the
  user cancelling a picker VS Code might show) left it set to the rejected
  promise permanently: every later call to either command would just
  re-await that same rejection, wedging the interactive window until a
  window reload, and the rejection itself reached VS Code's raw
  command-failure toast rather than this module's own friendly messaging.
  **Fixed**: `creatingTracked`'s `.then` now takes a rejection handler too,
  which clears the variable and rethrows, so the very next call starts a
  fresh `openNotebookDocument()` attempt; both call sites
  (`openInteractiveWindow`, `runSelectionInInteractiveWindow`, and the
  closed-notebook retry inside the new `appendAndRunCell`) now wrap that call
  in a `try`/`catch` and surface a `showErrorMessage` instead of letting the
  rejection propagate unhandled.
- **`runSelectionInInteractiveWindow` could race on `notebook.cellCount`
  across two overlapping invocations** (Claude reviewer, correctness #2) — a
  keybinding double-fire, or the command firing again before a previous
  call's edit/execute had settled, could let both calls read the same
  `cellCount` as their insertion index before either inserted; `applyEdit`
  doesn't fail on a stale index, so both edits would succeed, but the second
  insert would push the first call's own cell one slot along — one call's
  `executeCell` would then run the other call's cell (potentially twice)
  while its own appended cell never ran. The same class of bug
  `creatingTracked` was already fixed to prevent for notebook creation, just
  unaddressed for this read-index → insert → execute sequence. **Fixed**:
  the critical section is now its own function, `appendAndRunCell`, and every
  call chains its own invocation onto a module-scoped `pendingRun` promise
  rather than running immediately — so two overlapping calls always execute
  their critical sections one after the other, never interleaved. No new
  automated test was added for this specifically: reliably forcing two
  invocations to interleave at the exact right point is not something an
  integration test can assert deterministically without instrumenting the
  module's own internals, and the existing "two selections run without
  losing an execution" integration test already exercises the sequential
  (non-racing) path this change leaves unchanged.
- **Minor, left as-is, per both reviewers' own "not blocking" framing**: (1)
  the bounded 10s kernel-selection wait has no progress UI or cancellation,
  unlike comparable waits in `sessionManager.ts`/`csvExportCommand.ts` — those
  use dependency-injected `withProgress` wiring built for testability and
  cancellation together, and adding the equivalent here (plumbing a
  cancellation token through `waitForControllerSelection`, plus the test
  seam to exercise it) is more than a should-fix-sized change for a wait
  that's bounded and paid at most once per window; flagged for whoever next
  touches this module rather than built speculatively here. (2) A dedicated
  ADR for "bespoke interactive-window surface, not VS Code's real one" —
  the decision is already recorded at ADR weight in this file's own F7
  write-up and this module's doc comment; a standalone ADR file adds no new
  information, so one wasn't created without Sean asking for it.

`npm run verify` green after these fixes (1,814 unit tests unchanged;
coverage unchanged at 96.3/95.68/96.08/96.3 — `interactiveWindow.ts` stays
`.c8rc.json`-excluded). `npm run test:integration` green, same 457 passing
(454 pre-existing plus the three from round 1), confirming the serialization
change doesn't alter the sequential-call path's behavior. `npx tsc --noEmit`
and `npx eslint src/notebook/interactiveWindow.ts` both clean. One push for
this round, per the developer's own instruction to avoid re-triggering CI
and both AI reviewers per commit.

### 11a manual-test pass, 2026-09-17: rich-output gap investigated, found to be expected behaviour

Sean's own manual pass hit item 11.2 with `plt.show()` and a bare `df.head()`
as a cell's last line and got no rich output for either — filed as a
"partial" result. Investigated this session: **not a defect in 11a's own
code.** `interactiveWindow.ts` executes cells through the exact same
`notebookController.ts` path (`executeCell`/`appendRichOutput`) an ordinary
`.ipynb` cell already uses, and the underlying rule is
[ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)'s
own, already-documented behaviour (`docs/notebooks.md`'s "Output" section):
rich output is captured by noticing a file the user's own code **wrote**
(`fig.savefig(...)`, `df.to_html(...)`), never by an implicit `plt.show()` or
a bare trailing expression — `PROC PYTHON infile=` runs a plain script, with
no REPL displayhook and no display for a figure to draw on. Phase 9's own
manual pass hit this identical confusion once already (9.10/9.13's own
"would have read as a rendering bug" note) and reworded its repro instead of
treating it as a defect; the same fix applies here.
`docs/dev/manual-tests/phase-11.md`'s item 11.2 corrected in place: checkbox
reverted from `[-]` to `[ ]` (per `setup.md`'s own tagging-legend rule —
`[-]` means a confirmed, accepted gap, not an item awaiting a retest) and
the repro reworded to the file-writing form. **Retested by Sean, 2026-09-17,
with the corrected repro — passes**: `plt.savefig(...)`/`df.to_html(...)`
both render inline in the interactive window's cell, confirming
`interactiveWindow.ts` needs no change here — it was always exercising the
same, already-working `notebookController.ts` rendering path. Item 11.2 and
the 11a punch-list box above are both ticked.

**That correction surfaced a real usability question, not just a test-repro
mistake**: requiring an explicit file write for *any* rich output at all is
a genuine gap for the exploratory, plot-as-you-go workflow notebooks exist
for — every plotting call that doesn't end in an explicit `savefig`,
including ones from a library that manages its own figures without the user
ever touching `plt.show()`, currently produces nothing. Discussed with Sean
this session; the design that came out of it is recorded as **F10** in the
Plan section above, in real implementation-relevant detail specifically so
it survives to whoever picks it up. **Explicitly not decided and not
started — Sean's own call**: this needs a dedicated scoping session of its
own, is not something to settle inside 11a, and amends
[ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md) (the
"nothing may wrap or inject code around a user's own script" invariant),
which this project treats as a foundational, load-bearing record that only
gets reopened by explicit developer decision, not inferred from a write-up.
**No code was written or changed for F10 this session** — this entry and
F10's own Plan-section writeup are the entire output of this discussion.

### 11b — CAS/SWAT SQL passthrough helper

Both halves of the punch-list entry shipped together, in the same slice: the
documentation and the inserted-snippet command, decided in favor of once
drafting the doc made the shape of the command obvious rather than upfront.

**The design call this slice made:** unlike `casConnectCommand.ts` (8b),
which needs a live Compute session to deliver a fresh token into, F9's own
pattern (`fedsql.execDirect`/`connection to`) needs nothing beyond a `conn`
the user already has open from 8b's own command — the caslib name and the
native query are things only the user can supply, never wire data this
project fetches. That makes the command a fixed template with two VS Code
snippet tabstops, not a network-bound flow: no progress notification, no
`AbortSignal`, no server/adapter/session dependency at all, only the same
"is there an active Python editor" check 8b's own command opens with. New
files: `src/cas/sqlPassthroughSnippet.ts` (the `vscode`-free string builder,
`buildCasSqlPassthroughSnippet`, mirroring `connectSnippet.ts`'s own
`buildCasConnectSnippet` in shape but needing neither of `dragSnippet.ts`'s
two escaping layers — every character in the template is this module's own,
never wire data landing inside a Python or snippet-syntax literal) and
`src/cas/casSqlPassthroughCommand.ts` (the command itself, following
`casConnectCommand.ts`'s own "handlers factory, thin registration shell"
split). Registered in `extension.ts` right after 8b's own command.

**New command:** `pythonOnViya.insertCasSqlPassthroughSnippet` ("Insert CAS
SQL Passthrough Snippet"), gated by the same `enablement:
pythonOnViya.connected` 8b's own command uses — not because this command's
body ever touches the connection, but because the snippet it inserts is
meaningless without a `conn` for it to read, the same reasoning 8b's own
gating already established for this palette. Inserts:

```python
conn.loadactionset("fedsql")
result = conn.fedsql.execDirect(
    query='''select * from connection to ${1:CASLIB} (${2:select * from native_table})'''
)
df = result["Result Set"]
```

as a real `vscode.SnippetString` via `editor.insertSnippet` (not
`editor.edit`, unlike 8b — there is no untrusted wire value to worry about
reinterpreting as snippet grammar here, so a real snippet is the more useful
choice: the caslib name and native query are two independent tabstops a user
tabs through and fills in directly), with the same "not a Python file"
message 8b's own command reports.

**Documentation:** `docs/cas-python-connection.md` gained a new "Running
native SQL against an external database" section — the command, when to
reach for it (a caslib backed by an external database connector), the
mechanism, and Finding 11.2's forced single-node-read behaviour written as
an expectation to plan around, not a caveat or a defect. `docs/reference/commands.md`
regenerated (`npm run docs:reference`) to include the new command; the l10n
bundle needed no `npm run l10n:extract` diff, since the one user-facing
string this command reports (`"Open a Python file first, then run this
command again."`) is character-for-character 8b's own already-extracted
string, reused rather than duplicated.

**Verification:** `npx tsc --noEmit`, `npx eslint`, and `npx prettier
--check` all clean on every changed/new file.
`src/cas/casSqlPassthroughCommand.ts` is `.c8rc.json`-excluded, alongside
`casConnectCommand.ts`, for the same reason (built entirely on `vscode`, the
unit tier cannot reach it) — covered instead by
`test/integration/cas/sql-passthrough-command.test.ts`, mirroring
`connect-command.test.ts`'s own shape (happy path, no active editor, wrong
document language). `src/cas/sqlPassthroughSnippet.ts` is a plain unit test
(`test/unit/cas-sql-passthrough-snippet.test.ts`), asserting the exact
template text since — unlike `buildCasConnectSnippet` — there is no dynamic
input to vary across cases.

**A pre-push adversarial review caught that a probe actually was needed —
this section originally claimed otherwise, wrongly.** The reviewer flagged
that `result["Result Set"]` (the literal key both the snippet and the docs
assert) traces back to the pre-probe F9 candidate text, never to anything
Finding 11.2 itself observed: that finding's own probe ran raw `PROC CAS`
(`fedsql.execDirect result=r / query=...; print r;`), never `swat`, and
never inspected the result object's member names. Sean approved one more
execute-shaped probe step to close this properly rather than ship the
literal on faith — see **Finding 11.4**, below (recorded after Finding 11.3,
since it was probed after 11.1–11.3 despite the narrative reaching it here
first), which confirms it. This section's own earlier "no probe was needed"
line is corrected by this entry existing at all.

### 11b manual-test pass and a triple-quote fix, 2026-09-18

**Manual-test items 11.6 and 11.7 (`docs/dev/manual-tests/phase-11.md`) run
by Sean and passed** — the inserted template matches
`docs/cas-python-connection.md`'s own copy with the caslib-name and
native-query tabstops selected in order, and a real round trip against the
same Snowflake-backed caslib Finding 11.2/11.4 used came back as a usable
`pandas.DataFrame` with no error. 11b's full manual-test coverage
(11.6–11.7) is now green, alongside 11a's (11.1–11.5).

**One change made as a direct result of that pass:** the `query=` value in
`buildCasSqlPassthroughSnippet` (`src/cas/sqlPassthroughSnippet.ts`) now
wraps in Python triple quotes (`'''...'''`) instead of a single pair of
double quotes. Reasoning (Sean, from the manual test): the native-query
tabstop is free-form text only the user supplies, and some databases need
their own quoting inside it — Snowflake often requires double-quoted
identifiers depending on how a table/column was created, and a `where`
clause against a string value typically needs single quotes. A single
double-quoted Python string forces the user to escape any `"` inside their
own query to avoid ending the string early; triple-quoting removes that
trap entirely, since neither `'` nor `"` alone closes a `'''`-delimited
string. Updated together: the snippet builder, its unit test
(`test/unit/cas-sql-passthrough-snippet.test.ts`), and
`docs/cas-python-connection.md`'s own copy of the template, plus a new
paragraph there explaining the triple-quote choice. No `swat`/CAS behaviour
changed — this is Python string-literal syntax only, not a new probe
finding.

### 11c — Pre-release bug fixes (B1/B2/B3), 2026-09-18

**The punch list's own open design question — whether B1 and B2 share enough
of a mechanism to fix together — is answered by what each tree actually
does today, not by a shared mechanism.** CAS and SAS Content have no
"connected" concept of their own to flip (ADR-0033: CAS browsing needs only
a token and an endpoint, never a compute session; SAS Content is the same).
SAS Libraries does have one (`pythonOnViya.connected`, ADR-0027) and already
had a third `viewsWelcome` state for it (`notConnected`) — the gap there was
never the UI, it was that nothing told `src/compute` the cached session was
actually dead. So B1 and B2 turned out to be two different shapes of the
same underlying problem — a failed call with nowhere to render and no way to
correct the extension's own stale belief — fixed by two small, independent
pieces rather than one shared state machine:

- **B1 — a new `ConnectionProblemNode`** (`src/connectionProblemNode.ts`,
  `vscode`-dependent, deliberately kept out of the three domains' own
  `vscode`-free item unions per each one's own top-of-file rule). Each
  tree's own local `*TreeNode` type (`CasTreeNode`/`ContentTreeNode`/
  `DataTreeNode`) widens `getChildren`'s return type to include it; a failed
  listing — at whatever level it fails, not only the root — now returns one
  of these instead of `[]`, carrying that domain's own already-existing
  user-facing sentence (`localiseCasProblem`/`localiseContentProblem`/
  `localiseDataProblem` — previously used only by each domain's one
  network-facing command, per each `messages.ts`'s own doc comment, now also
  by the read-only tree) and a click that runs that view's own refresh
  command. The two `TreeDragAndDropController` implementations
  (`contentDragAndDrop.ts`, `dataDragAndDrop.ts`) needed a matching type
  widening plus a guard excluding the new node from what counts as
  draggable or a valid drop target — a mechanical consequence of
  `vscode.window.createTreeView`'s single shared type parameter across
  `treeDataProvider` and `dragAndDropController`, not a design choice of its
  own.
- **B2 — `SasLibraryTreeProvider.getChildren` now calls `forgetProfile`**
  (threaded in from `extension.ts`'s existing `ComputeCommandHandles`, the
  same handle `src/run/commands.ts` already takes) when a listing's own
  failure reads as `ComputeProblem` `session-gone` — the session this window
  believed it still held is actually gone, discovered by *browsing* rather
  than by running anything, a path the existing `backend-gone` handling
  never covered. **Extended mid-session (Sean's own report) to
  `src/cas/casConnectCommand.ts`'s `pythonOnViya.insertCasConnectionSnippet`
  too**: that command's `writeCasToken` failure path already showed
  `localiseComputeProblem`'s "no longer available" sentence for exactly this
  case but never told `src/compute` its own cached connection was stale —
  `compute/messages.ts`'s own doc comment says as much ("`session-gone` has
  a message, and it is nearly always wrong to show it... the caller's
  correct response is to start another one"), and this command was the one
  caller not following that rule. Both call sites mirror
  `run/commands.ts`'s own `forgetIfGone`. Before this fix the only way back
  to a working **Connect** was **Disconnect** — a full sign-out-shaped
  action — for a session that was never actually signed out.
- **B3 — `src/data/presentation.ts`'s table icon changed from
  `symbol-array` to `table`**, matching the icon `src/cas/presentation.ts`
  draws for a *loaded* CAS table. SAS Libraries has no unloaded state of its
  own to distinguish (a `DataAccessApi` table is whatever the session's own
  libref already resolved — Phase 7 never needed a JIT-load concept), so
  this is the one icon, not CAS's loaded/unloaded pair.

**Test coverage added or changed**: `src/connectionProblemNode.ts` is
`vscode`-only (added to `.c8rc.json`'s exclude list, matching the other
tree-shell files); its behaviour is exercised through all three trees'
integration tests rather than a standalone one. `test/integration/cas/tree.test.ts`
and `test/integration/content/tree.test.ts` both gained an assertion on the
connection-problem node's icon/command where their existing "logs and
returns `[]` on a failed listing" case used to stop at the log. **A new
`test/integration/data/tree.test.ts` was added — `dataTree.ts` had no test
file at all before this slice**, a gap the Phase 7→8 housekeeping checkpoint
never caught because `casTree.ts`/`contentTree.ts` already had theirs;
covers the happy path, the `not-connected` case (no `forgetProfile` call —
nothing to correct), the `session-gone` case (`forgetProfile` called with
the right profile id), and a failure unrelated to the session being gone
(`forgetProfile` not called). `test/integration/cas/connect-command.test.ts`
gained a `forgotten` tracker on its harness and an assertion on the existing
"reports a Compute problem from writeCasToken" case that `forgetProfile`
now fires too. `test/unit/data-presentation.test.ts` updated for B3's icon
change.

`npm run verify` and the integration tier both green — see this session's
own verify run for exact numbers, recorded in `STATUS.md`. No probe was
needed: nothing here is Viya wire behaviour, it is this extension's own
client-side state handling.

### 11d — CAS table properties and CSV export (F2/F3), 2026-09-19

**What shipped.** Two new commands on the CAS tree's table node —
`pythonOnViya.showCasTableProperties` and `pythonOnViya.exportCasTableToCsv` —
separate ids from the SAS Libraries tree's own, the same split
`openTable`/`openCasTable` already make (one command id cannot carry two
handlers). Both reuse the existing surface rather than fork it:

- **Properties.** `tablePropertiesPanel.ts` now renders a `PropertiesView`
  (`src/data/propertiesSource.ts`, pure types) handed to it by a
  `PropertiesSource`. `LibraryPropertiesSource` is 7c-ii's field set moved
  out unchanged; `CasPropertiesSource` is new, reading `CasAdapter.getTableProperties`
  (loads first if needed, then re-reads `self` — Finding 11.5) plus the
  existing `getColumns`. Sources emit plain text and the panel escapes once,
  so the module's old `formatOptionalText`/`formatOptionalTimestamp` (which
  escaped) became dead and were removed with their tests.
  `TablePropertiesPanelManager.open(table, adapter)` stays as a wrapper.
- **CSV.** `runCsvExport` is now a wrapper over `runSourceCsvExport`, which
  takes a `CsvExportSource` (`open`/`sample`/`stream`). The save dialog,
  progress, temp-file-then-rename, and disk-space pre-flight are unchanged and
  shared. `CasCsvSource` reads JSON pages and formats CSV client-side
  (`src/cas/csvFormat.ts`) rather than relaying the server's `text/csv` —
  Finding 11.5. Page size is `pageRowsFor(columnCount)` (30,000 cells/page,
  at most 500 rows) to stay under the transport's 1 MiB body cap on wide
  tables (Finding 11.6).
- **Large-table confirmation (Sean's request, mid-slice).** `runSourceCsvExport`
  asks — a modal warning naming the row count and estimated size, with an
  "Export anyway" button — when a source names `confirmAboveBytes` and the
  size estimate (the same sampled projection the disk-space check uses)
  exceeds it. CAS sets 100 MB. It is asked *before* the disk check, and
  declining is a silent no-op that creates no file. SAS library tables set no
  threshold yet — tracked as the punch-list follow-up above.

**Design calls worth knowing.** (1) The 100 MB threshold is a judgement, not a
measured limit: Finding 11.6 found no server-side cap to anchor it to; it is
about where a wide table becomes ~100 pages and minutes rather than seconds.
(2) The estimate is a projection from the first 200 rows, so a table whose
later rows run wider can pass — the same caveat the disk-space check already
carries. (3) Missing/padded numerics are cleaned only by column *type*
(`char`/`varchar` untouched, everything else trimmed, `.` -> empty); `date`/
`datetime`/`decimal`/`int64` cell display was **not** probed (only `char`,
`varchar`, `double` were reachable without loading more tables) — trimming is
harmless for them but a `.`-for-missing reading is assumed, not observed.

**Not built / carried:** a progress percentage during export (the row count is
known, but the notification is indeterminate — same as the SAS library
export); an unbounded-table safety net beyond the confirmation; a table size
on the CAS Table Properties panel (raised in the manual pass — it would help
judge the confirmation's estimate, but whether CAS exposes a byte size is
unprobed, so it is a new feature, not a 11d fix).

**Review and manual pass, 2026-09-20.** The pre-PR adversarial review found
nothing blocking. Folded in: an isolation test for `LibraryCsvSource`
(`test/integration/data/library-csv-source.test.ts`), since it had only been
reached through the command. Deliberately not changed: (1) `CasCsvSource.open`
reads one row for the live count and `sample` later reads the first N — one
extra round-trip per export, and removing it means caching a page across the
two calls; (2) `open()` runs before the confirmation, so a declined export of an
unloaded CAS table can leave it loaded server-side — the row count the estimate
needs comes from that same load. Manual items 11.15–11.22 all pass; on the
555,856-row table the modal arrives only after a long wait (open, load,
columns, count and a 200-row sample all precede it). A live read-only probe
of that table's first 200 rows projects ~389 MB as CSV (~734 bytes/row; later
windows ~970 bytes/row, ~520 MB), so the estimate errs low for it — still well
over the 100 MB threshold. Integration suite 489 passing after the added test.

**Tests.** `test/unit/cas-csv-format.test.ts` (new), plus additions to
`cas-adapter.test.ts` (`getTableProperties`), `cas-types.test.ts`,
`data-csv-export-model.test.ts` (`streamCsvPages`);
`test/integration/cas/csv-export-and-properties.test.ts` (new) drives the real
CAS sources through the real command/panel, and covers the confirmation
through a fake source. Five new `vscode`-importing or types-only files added
to `.c8rc.json`'s exclude list. `npm run test:integration` green (482
passing).

Findings in this section are numbered `11.x`, per the phase-scoped
finding-numbering scheme adopted 2026-09-09 (`STATUS.md`, repo-root
`CLAUDE.md`) — this is the first finding recorded for this phase, so it
starts fresh at `11.1` rather than continuing any other phase's count.

### 11e — Session startup: `sasOptions` and `autoExec`, 2026-09-20

**Scoped with Sean (2026-09-20):** SAS-side startup only, mirroring upstream's
profile fields — `sasOptions` plus `autoExec` as `line` or `file` entries — and
**not** a Python startup snippet. That one would need its own `PROC PYTHON`
submission per session and interacts with ADR-0014's "nothing wraps the user's
bytes" rule and with `restart`/namespace lifetime, so it is left as a candidate
for a dedicated scoping pass, not built. `createSession` already accepted
`options` and `autoExecLines`; nothing passed the latter, so 11e is profile
schema, parsing, and wiring, plus the wire fix below.

**What shipped.** `ViyaProfile` gains optional `sasOptions: string[]` and
`autoExec: AutoExecEntry[]` (`src/profile/model.ts`; strict per-profile
rejection when malformed, empty arrays read as absent). A new pure module
`src/profile/sessionSetup.ts` formats options (first `=` -> space), merges them
after the extension's own, and flattens `autoExec` (file reads injected).
`ComputeSessionManager.open` builds both and passes them to `createSession`;
files are read with `vscode.workspace.fs`, and an unreadable one is skipped with
a message. The one create site serves Run File, the interactive window and
notebooks alike. `ComputeSession` now carries `conditionCode`, and a nonzero one
with autoExec present raises a message (Finding 11.7). The settings schema and
`package.nls.json` describe both fields; **Edit Connection Profile** now carries
them over (it rebuilt the profile from four fields and would have dropped them);
**Import Connection Profiles** maps upstream's identical fields.

**A pre-existing bug this fixed.** Finding 11.7: `SESSION_OPTIONS =
["PAGESIZE=MAX"]` (3f) was accepted and never applied, so the page-break-banner
suppression it was added for never took effect. It is now `"PAGESIZE MAX"`. This
changes what sessions do (banners can no longer appear), which is the intent 3f
documented.

**Deliberately not built:** surfacing the *text* of an autoExec error — that
means reading the session log, which no code here does yet; the message says an
error occurred and the docs say where it is. Left as a follow-up on the punch
list.

**Pre-PR adversarial review (2026-09-21):** no blocking findings. One real gap,
folded in: `editProfile`'s carry-over of `sasOptions`/`autoExec` had no test (the
command had none at all). `test/integration/profile.test.ts` now runs **Edit
Connection Profile** against a profile carrying both, with the prompts stubbed,
and asserts they survive an endpoint edit. The reviewer also traced the trust
question — a workspace `settings.json` naming an arbitrary `autoExec` file — to
`runConnect`'s untrusted-workspace refusal, which precedes any session build, so
no new hole. The reviewer also noticed `CHANGELOG.md`'s `[Unreleased]` was empty
for all of 11a–11e; that was a real gap (`RUNBOOK.md` requires an entry per PR),
not practice, and it is now filled for the whole phase.

**PR #199 review (2026-09-21):** four comments, no blocking ones. Three were
real and are fixed: the `log.warn` for a skipped autoExec file bypassed
`vscode.l10n.t()`; `buildSessionOptions`'s ordering rested on "SAS takes the
last setting", which no probe had established for a *duplicate* name in one
`environment.options` array (probed, now Finding 11.9, and both the comment and
`docs/connection-profiles.md` cite it); and CodeQL flagged the trailing-newline
regex as backtracking-prone (replaced by popping empty trailing elements). The
fourth pointed out that `NAME =VALUE` — an `=` one typo's worth of whitespace
past the name — is passed through unchanged rather than normalised. That is left
as it is, deliberately: nothing has probed what the service does with that form,
and rewriting it would invent an intent the user may not have. The behaviour is
now stated in `formatSasOption`'s doc comment and pinned by a test.

**Verification:** `npm run verify` green (1,856 unit tests; coverage
96.38/95.85/96.16/96.38; `check:secrets` 521 files), `npm run check:docs`
green, `npm run test:integration` green (495 passing, as of the last
recorded run). **Manual pass, 2026-09-21: items 11.23–11.28 all pass.** 11.26
first showed no warning for a bad autoExec line; that was Finding 11.8, fixed
and re-run to a pass.

### AI-agent integration scoping, 2026-09-22

Sean brought a research memo written the previous day
(`docs/research/ai-integration-2026-09-21.md`, now checked into the repo) that
answered a question raised outside any phase: can this extension let a user
plug an AI agent they already pay for — Claude Code above all — into it. The
memo surveyed five options (skill, `languageModelTools`, an in-process MCP
server also reachable externally, a standalone MCP server, and consuming a
model in-extension) and recommended shipping the skill immediately and
spiking the in-process-MCP-server option before committing to it. Its own
view was that if any of this proceeds it should be a new phase, since Phase
11 is scoped to parity gaps and this is net-new surface — Sean's explicit
call was to fold it into Phase 11 instead, as two new slices. Recorded as
[ADR-0037](../adr/0037-ai-agent-integration-approach.md), which also records
that departure from the memo's own recommendation.

Added to this phase's Plan section (above) and the punch list (below) as
**11f** (ship the skill; no code) and **11g** (the spike; exploratory,
outcome recorded here once run — decides whether a real build gets scoped
next or the project falls back to registering `languageModelTools`
instead). Neither slice has started as of this entry; both are unordered
relative to 11d's three open follow-ups and 11e's two, beyond sitting last
in the Plan section's priority list.

### Phase 11 follow-up decisions, 2026-09-22

Sean worked through the open decisions this file's punch list had been
carrying, in one pass:

- **All three 11d follow-ups (large-table confirmation for SAS library
  tables, a `CasProblem` for an oversized response, the opt-in CSV
  formula-injection guard) and the 11e autoExec-error follow-up: decided to
  build**, each recorded inline on its own punch-list item above. None has
  started.
- **The 11e Python-startup-snippet follow-up: not decided, and correctly
  so** — Sean's own read was that there wasn't enough insight into how it
  would actually work to make the call, so rather than guess, this session
  scoped an investigation instead: **11h**, added to the Plan section and
  punch list above. 11h is a spike, the same shape as 11g — its job is to
  answer the submission-mechanism and namespace-survival questions ADR-0014
  and `RESTART_STATEMENT` (`src/backend/procPython.ts`) raise, not to build
  the snippet feature itself. The startup-snippet follow-up stays open until
  11h reports back.
- **Result panel styling options: closed, not built.** The only description
  this project ever gave it was the original one-line phase mention; no ADR,
  design note, or concrete complaint backed it. What it would plausibly have
  meant — following the editor's own theme — is already true, unprompted,
  because the result panel's stylesheet reads VS Code's own CSS variables
  directly (`resultPanel.ts:477`). Recorded in the Plan section's own
  paragraph, above, rather than silently dropped.

### Finding 11.1 — At least one DBMS-backed caslib exists in this environment, checked by a mechanism outside this project's own probe skill

Checked 2026-09-16, read-only, while scoping candidate F9 (Plan, above) —
**not** via this project's own `viya-api-probe` skill and `creds.json`, the
mechanism every other finding in this repository was produced by. Instead,
this ran through a separate MCP connector (`sas-viya-mcp`) already available
in that session's environment. Its own authentication is opaque to this
project (no `creds.json` involved), and which deployment it targets was not
independently cross-checked against `verde`, the deployment every other
finding here is explicitly scoped to. **Recorded as its own, flagged finding
rather than folded in silently, precisely so it is not mistaken for a
`viya-api-probe`/`verde` result later** — treat it as weaker evidence than
the rest of this ledger until that mechanism/deployment question is settled.

**What it actually showed:** `list_cas_servers` returned one CAS server
(`cas-shared-default`); `list_caslibs` against it returned caslibs of type
`snowflake` (three), `S3` (two), and `DNFS`/`PATH` (the remainder) — a
read-only metadata listing only, no query run against any of them. **What it
establishes:** F9's premise is grounded in a real environment rather than a
hypothetical one — a DBMS-backed (Snowflake) caslib genuinely exists
somewhere this session could reach. **What it does not establish:** whether
FedSQL explicit pass-through (`fedsql.execDirect`/`CONNECTION TO`) actually
works against any of those caslibs, whether this is the same deployment as
`verde`, or anything about credential handling for that connector — all
three are open items for whoever picks up F9, and the first genuinely needs
a `viya-api-probe` pass against `verde` before any code or documented pattern
is written, per this project's own "don't guess about Viya — probe it" rule.
**Closed by Finding 11.2, below**, which resolves all three via `verde`
itself and this project's own `viya-api-probe` skill.

### Finding 11.2 — FedSQL explicit pass-through against a Snowflake caslib confirmed working on `verde`

Probed 2026-09-16/17, via `viya-api-probe`/`creds.json` against `verde`
directly (the mechanism every other finding in this repository is scoped
to), with Sean's explicit go-ahead for the execute-shaped step. This
independently confirms Finding 11.1's premise on the deployment this
project actually targets, rather than the separate, unverified one Finding
11.1 touched.

**Caslib check (read-only, `casManagement`):** `verde`'s single CAS server
(`cas-shared-default`) has 69 caslibs; `GET .../caslibs/{name}` on the two
whose names suggested a Snowflake connector confirmed one, `SNOWLIB`
(`attributes.sourceType`/top-level `type: "snowflake"`), scoped to Sean's own
`RND_DB`/`SEFORD` database/schema under his own `seford` connector uid — a
personal sandbox caslib, not a shared production one, and safe to query
without touching anything business-identifying. (The collection listing
itself — `GET .../caslibs` — returns `casLibType`/`sourceType` as `null` for
every item; the type only appears on the per-caslib detail resource,
`GET .../caslibs/{name}`, at top-level `type` — worth knowing for anyone
scripting a "find me a DBMS caslib" scan.)

**Pass-through check (execute-shaped, approved):** a compute session under
the "SAS Studio compute context" ran:

```sas
cas mysess;
proc cas;
  session mysess;
  fedsql.execDirect result=r / query="select 1 as X from connection to SNOWLIB (select 1)";
run;
print r;
quit;
cas mysess terminate;
```

**Documented (SAS FedSQL Programming for CAS; SAS blog, "Python Integration
to SAS Viya — Executing SQL on Snowflake", 2024-04-12):** `fedsql.execDirect`
with a `select ... from connection to <caslib> (<native SQL>)` query runs the
parenthesized SQL natively in the external database and returns the result
as a FedSQL result set. **Observed (Viya 4, `verde`, 2026-09-16):** matches —
the job completed cleanly, `fedsql` action-set loaded automatically, and the
printed result (`X = 1`) is exactly the inner Snowflake query's own answer,
round-tripped with no CAS-side transformation. Documentation confirmed, not
contradicted, on this point.

**One behavioural note the documentation above doesn't foreground:** the log
carried `WARNING: Multi-node read is not allowed with the FedSQL execDirect
action. The load will proceed with numReadNodes=1.` — an explicit
pass-through query runs single-threaded on the CAS side regardless of the
server's worker count. Worth a line in F9's eventual documentation as a
performance expectation (a passthrough query is not accelerated by CAS's own
parallelism, only by whatever the external database itself does), not a
defect.

**One raw-SAS probe wrinkle, not a finding about production code:** `PROC
CAS` needs an explicit `CAS mysess;` global statement establishing a session
before `session mysess;` can reference it — the first attempt, without it,
failed with `ERROR: There is no server connection to execute the action`.
This has no bearing on F9's actual Python/SWAT delivery path
(`src/cas/connectSnippet.ts`'s `buildCasConnectSnippet`): `swat.CAS(host,
port, password=token)` establishes the session as part of the constructor
call itself, with no separate session-creation step for calling code to get
right — confirmed by Sean from his own prior SWAT experience while this
probe was running. Recorded here only so a future raw-SAS-shaped probe
doesn't re-trip on the same thing.

**What this establishes:** F9's core mechanism — loading the `fedsql` action
set and calling `execDirect` with a `connection to`-style query, returning a
usable result — works on `verde`, against a real Snowflake-backed caslib, via
the exact connection shape `buildCasConnectSnippet` already generates for
Phase 8b. **What it does not
establish:** behaviour against caslib types this deployment's `SNOWLIB`
doesn't exercise (a different connector, a query returning a large result
set, an inner query the external database itself rejects) — those stay open
for whoever implements F9. **Cleanup:** the throwaway `casManagement` session
and the compute session both `DELETE`d and confirmed `404` on read-back; the
CAS session itself (`mysess`) was terminated by its own `cas ... terminate;`
statement before that.

### Finding 11.3 — A bare trailing expression's value is never produced anywhere in the log; the `>>>` prompt is cosmetic, not a real REPL echo

Probed 2026-09-17, via `viya-api-probe`/`creds.json` against `verde` directly,
prompted by a question raised while discussing **F10** (above): Finding
74/93 (`docs/phases/phase-3.md`/`phase-5.md`) already established that
`PROC PYTHON`'s log shows a genuine CPython startup banner and `>>>` REPL
prompt markers on every run, even though the code arrives via file upload
plus `infile=`, never typed interactively. That raised a real question worth
settling before F10 assumes it needs a whole AST-splitting driver: **if the
embedded interpreter is already behaving enough like a REPL to print `>>>`,
does it also already call `sys.displayhook` on a bare trailing expression,
with the value just sitting unfiltered in the log where nothing currently
looks for it?** If so, F10 could have been a matter of *reading* the log
differently, not changing what runs.

**Documented:** nothing in `PROC PYTHON`'s own option list
(`COMMAND ECHO INFILE RESTART SRC TERMINATE TIMEOUT`, ADR-0014 finding 34)
or SAS's FedSQL/`PROC PYTHON` documentation describes an interactive
display/echo behaviour for a submitted file's own trailing expression —
Finding 93's own "accept and document" call was scoped to the banner and
prompt characters themselves, not to what a REPL usually does with a
result. This probe tests the specific, previously-unasked-and-unanswered
question directly rather than infer an answer from the banner's presence.

**Probe:** two throwaway compute-session jobs against `verde`'s "SAS Studio
compute context" (the same one Finding 11.2 used), each a two-line file run
via `proc python infile=<fileref>; run;` — first `x = 5` / bare `x` (a fresh
session, printing the full startup banner), then, in the same session,
`x = "hello"` / bare `x` (to disambiguate an auto-echoed `repr()` — which
would show quotes — from some other artifact). Both jobs completed
(`SYSCC`-equivalent: no error).

**Observed:** the `>>>` prompt lines appear exactly as Finding 74/93 already
described (one per submitted top-level statement, `normal`-typed, no
source echoed alongside per ADR-0014). **Neither `5` nor `'hello'`/`hello`
appears anywhere in either job's log, in any line, of any type** —
checked across all four SAS log-line types this project's own
`logFilter.ts` distinguishes (`normal`, `note`, `source`, `title`), not
just the ones `isNoiseLine` currently drops. The full log content for both
runs is recorded in this session's own transcript rather than duplicated
here; the relevant fact is purely the absence.

**What this establishes:** the `>>>` prompt is decorative — cosmetic
interpreter-startup behaviour, not evidence of a real interactive
read-eval-print loop underneath. `PROC PYTHON infile=` behaves, for a bare
trailing expression, exactly like an ordinary non-interactive script run
(`python file.py`): the value is evaluated and discarded, full stop. **This
closes off one specific hypothesis for F10, cleanly and negatively**: there
is no hidden channel to recover a bare expression's value from — nothing
this project's own log filter is dropping, and no server-side flag left
unprobed that would turn the echo on. F10's own mechanism (an AST-split
"cell runner" that explicitly evaluates and displays the last expression)
remains the only path to that behaviour; this finding removes a
simpler-sounding alternative from consideration rather than opening one.
**Cleanup:** both filerefs `DELETE`d (`204`), the session `DELETE`d (`204`)
and confirmed gone (`404` on read-back).

### Finding 11.4 — `fedsql.execDirect`'s result carries a member named `Result Set`, confirmed by both a positive and a negative control

Probed 2026-09-18, via `viya-api-probe`/`creds.json` against `verde` directly,
with Sean's explicit go-ahead for the execute-shaped step (the same kind of
approval Finding 11.2 already had). Prompted directly by a pre-push
adversarial review finding on 11b (above): 11b's own snippet and docs assert
`result["Result Set"]` as fact, but Finding 11.2 never actually probed a
`swat`-side call, only raw `PROC CAS`.

**The reasoning that made a `PROC CAS`-only re-probe sufficient, without
standing up `swat`/Python at all** (Sean's own suggestion, mid-session): a
CAS action's result-member names are a **server-side** attribute — the same
member names appear regardless of which client library reads them, `swat`
or SAS's own `PROC CAS` — so confirming the member exists via `PROC CAS`
settles the wire-level half of the claim just as well as a `swat` call
would, without the added complexity of standing up a CAS binary/REST
connection from a throwaway Python probe script.

**Probe (positive control):** the same job shape Finding 11.2 used, plus one
new line explicitly indexing the result by the literal key in question:

```sas
cas mysess;
proc cas;
  session mysess;
  fedsql.execDirect result=r / query="select 1 as X from connection to SNOWLIB (select 1)";
run;
print r;
print r["Result Set"];
quit;
cas mysess terminate;
```

**Observed:** no `ERROR` anywhere in the log; `NOTE: The PROCEDURE CAS printed
pages 1-2` — two real pages, one per `print` statement. `fedsql`'s own
action-set load and the `numReadNodes=1` warning Finding 11.2 already
documented both appear again unchanged.

**Probe (negative control, same session shape, a deliberately wrong key):**

```sas
print r["TotallyNotARealKey"];
```

**Observed:** a materially different log signature — `WARNING: Variable
'TotallyNotARealKey' is uninitialized. It has been set to missing.` and no
"printed pages" `NOTE` at all. This confirms the positive control's silence
is meaningful (a real, existing member), not an artifact of `PROC CAS`
silently tolerating any key.

**What this establishes:** `fedsql.execDirect`'s result object carries a
member literally named `Result Set` on `verde`, confirmed at the wire/server
level. **What this does not establish, and does not need to**: the exact
Python type `swat` wraps that member in when read via `conn.fedsql.execDirect(...)["Result Set"]` —
that is `swat`'s own client-side behaviour, not deployment-specific wire
behaviour, and is documented directly by `swat`'s own reference
documentation rather than needing a live probe: `CASResults` is "a subclass
of Python's ordered dictionary" whose table-valued members `swat` returns as
`SASDataFrame`, itself "a simple subclass of `pandas.DataFrame`" ([SWAT
API Reference](https://sassoftware.github.io/python-swat/generated/swat.cas.results.CASResults.html);
[`swat.SASDataFrame`](https://sassoftware.github.io/python-swat/generated/swat.dataframe.SASDataFrame.html),
both fetched 2026-09-18). Together, the two closes the entire claim
`sqlPassthroughSnippet.ts` and `docs/cas-python-connection.md` make: the
member exists (probed, this finding) and `swat` exposes it as a
`pandas.DataFrame` subclass (documented, `swat`'s own reference).
**Cleanup:** both throwaway compute sessions (`mysess`, `mysess2`) were
already gone by the time of the negative control's own `cas ... terminate;`
statement; the compute session resource itself was `DELETE`d and confirmed
`404` on read-back. **One operational wrinkle worth recording, not a finding
about production code**: this probe's own first attempt hit a real VPN drop
mid-session (a long idle gap between approval and execution) — the first
throwaway compute session had already been cleaned up server-side by the
time connectivity returned, confirmed via a `404` on that stale session id
before a fresh one was created for the actual probe.


### Finding 11.5 — A CAS table's own representation, `rows` as `text/csv`, and the space-padded numeric display

Probed 2026-09-19, `verde`, Viya 4, read-only except one JIT load of
`P_FORD.HEART` (Sean approved; unloaded again afterwards, `200`).
**Documented:** the Row Sets reference (developer.sas.com) names `start`/
`limit` paging and nothing about content types on a CAS table or a maximum.
**Observed:**

- `GET .../tables/{name}` (`self`) on an **unloaded** table carries no
  timestamps, `encoding`, or real counts (`rowCount`/`columnCount` are `0`);
  after `PUT .../state?value=loaded` the same link returns `created`,
  `createdBy`, `lastModified`, `lastAccessed`, `encoding`, `characterSet`,
  `scope`, `repeated`, and real counts. `getTableProperties` therefore loads
  first.
- `casManagement` columns carry `rawLength` (absent on some `varchar`s) and a
  `label` (present on some columns, absent on others); no `format`/`informat`.
- `GET /casRowSets/.../rows` with `Accept: text/csv` **works**: `200`,
  `text/csv`, `start`/`limit` honoured, `includeColumnNames=true` adds a
  header row, `sortBy`/`where` work on it, a page past the end is a `200` with
  an empty body, RFC-4180 quoting for a comma-bearing field. (Same shape as
  Finding 7.20.) A bad `where` is a `409` with CAS's own message.
- **But numeric values arrive as formatted, space-padded strings, in both the
  JSON `cells` and the CSV** — `"          29"`, and a missing numeric as
  `"           ."`. Char/varchar are unpadded. So a straight relay of the
  server CSV is not usable as a data file; the CAS export formats client-side.
  **Not settled:** the same reading for `date`/`time`/`datetime`/`decimal`/
  `int` columns.

### Finding 11.6 — CAS enforces no row cap on `rows`; a large table is slow, not refused

Probed 2026-09-19, `verde`, read-only, against `P_MTES.COMMERCIAL_PRESALES_ORION_V2`
(555,856 rows x 76 columns, the largest loaded table in 69 caslibs). A
`rows` request returned `200` at every size tried: `limit=500` -> 458 KB in
1.6 s; `limit=5000` -> 4.6 MB in 2.4 s; `limit=100000` -> 96 MB in 29 s
(exactly 100,000 items). A window at the tail returned the remaining 356 rows;
`start` past the end returned `200` with zero items. `count` stayed populated
throughout. **No server-side maximum was found**, and none is documented; the
ceiling that bites is this client's own 1 MiB response cap
(`src/auth/transport.ts`), which is why export pages are capped by cells
(`pageRowsFor`). At ~915 bytes/row for that table, a full export is on the
order of 500 MB and >1,000 page requests. **Not settled:** the maximum a
single request could return before failing (only tried to 100,000 rows);
behaviour on a far larger table; whether the per-request ephemeral CAS
session (Finding 8.13) accumulates across a thousand-page export.

### Finding 11.7 — `environment.options` needs `NAME VALUE`; `NAME=VALUE` is silently ignored; a bad `autoExecLines` statement leaves the session `idle` with `sessionConditionCode` 3000

Probed 2026-09-20/21, `verde`, via `viya-api-probe`, with Sean's explicit
approval of the mutating steps (throwaway sessions on the "SAS Studio compute
context", each followed by a job that read the effect back with `%put
%sysfunc(getoption(...))`; every session deleted and confirmed `404`).

**Documented (upstream `vscode-sas-extension`, `formatSASOptions`):** options
go in `environment.options`, with `=` rewritten to a space (`["-PAGESIZE=MAX"]`
-> `["-PAGESIZE MAX"]`). **Observed:** upstream is right, and this project's
own `SESSION_OPTIONS = ["PAGESIZE=MAX"]` (shipped 3f, 2026-08-28) was **never
applied**.

| `options` sent | read back |
|---|---|
| `PAGESIZE=MAX`, `YEARCUTOFF=1950` | `PAGESIZE`=60, `YEARCUTOFF`=1940 (defaults; **accepted with no error, not applied**) |
| `YEARCUTOFF 1951`, `PAGESIZE MAX` | 1951, 32767 |
| `-YEARCUTOFF 1952`, `NONUMBER` | 1952, `NONUMBER` (leading `-` and a bare switch both work) |
| `FMTSEARCH=(work sashelp)` | unchanged (same `=` behaviour) |
| `LINESIZE 97`, `NOSUCHOPTION` | session `state: "failed"`; a job on it -> `400`, `errorCode` 5113, `details` `ERROR: Unrecognized SAS option name NOSUCHOPTION.` |

**`autoExecLines`:** `%let X=hello;` and `libname p "/tmp";` both take effect in
the session's global scope (`&X` resolved in a later job; `libref()` = 0). A
statement that is not valid SAS does **not** fail the session: `state` is
`idle`, lines after it still run, `ERROR 180-322` appears only in the session
log, and the create response's `sessionConditionCode` is **3000** (superseded
by Finding 11.8: that create had already settled to `idle`; a `pending` create
reports 0) (a clean start is 0; `failureMessages` absent either way). The site's own autoexec runs first
(its lines appear in the same session log).

**Not settled:** whether `FMTSEARCH (work sashelp)` (space form with
parentheses) is applied — only the `=` form was tried. The first two create
attempts (both carrying autoExec lines) returned `500` "process initialization
... timed out after 60 seconds" and did not recur on the later creates,
including the identical bad-autoExec line, so this reads as a cold launcher
rather than a property of autoExec (not proven). An autoExec that runs for
minutes (would presumably hit that same 60 s initialization limit) was not
tried. Viya 3.5 behaviour is moot (ADR-0022).

### Finding 11.8 — a `pending` create response reports `sessionConditionCode` 0; the 3000 shows only on a later `GET` of the session

Probed 2026-09-21, `verde`, via `viya-api-probe`, with Sean's approval of the
mutating step (one throwaway session on the "SAS Studio compute context",
deleted, `404` confirmed). Found by manual test 11.26: no warning was shown for
a bad autoExec line.

**Documented / assumed (Finding 11.7 as first written):** the create response's
`sessionConditionCode` is 3000 after a bad autoExec line. **Observed:** that was
true only for a create that had already come back `idle`. Sending
`autoExecLines: ["this is not valid sas;", "%let P11E=after;"]`, the `201`
create response was `state: "pending"`, `sessionConditionCode: 0`; the first
`GET /compute/sessions/{id}` was still `pending` but already `3000`; the next
was `idle`, `3000`. `waitWhilePending` keeps only `state`/`etag` from its polls,
so the code was never seen and no warning fired. Two creates, two shapes
(11.7's came back `idle`/3000, this one `pending`/0), so the create response's
code is simply not final. The extension now re-reads the session
(`attachSession`) once it settles, when the profile has autoExec lines, and
warns in wording that does not blame the profile's lines: the code is
session-wide and the site's own autoexec runs first (Finding 11.7). Only 3000
after an `ERROR` was measured; any nonzero code is treated as a problem.

**Not settled:** whether a failure reading the session should ever be louder
than a debug log line (it currently only costs the warning).

### Finding 11.9 — a duplicated option in `environment.options`: the later entry wins

Probed 2026-09-21, `verde`, via `viya-api-probe`, with Sean's approval of the
mutating steps (two throwaway sessions on the "SAS Studio compute context", each
read back with `%put %sysfunc(getoption(pagesize))`; both deleted, `404`
confirmed). Raised by the PR #199 AI review: `buildSessionOptions` orders profile
options after the extension's own on the claim that the last setting wins, and
Finding 11.7's rows all used distinct option names.

**Documented / assumed:** SAS takes the last setting of an option. **Observed:**
correct, and neither request was rejected.

| `options` sent | `PAGESIZE` read back |
|---|---|
| `PAGESIZE MAX`, `PAGESIZE 60` | 60 |
| `PAGESIZE 60`, `PAGESIZE MAX` | 32767 |

**Not settled:** duplicates of options other than `PAGESIZE`; the same option
given once as `-NAME` and once as `NAME`.


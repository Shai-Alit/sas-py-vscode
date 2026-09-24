# Phase 12 — AI-agent integration

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 12 — AI-agent integration

Created 2026-09-22 (Sean's own call), moved out of Phase 11 the same day —
see [`docs/phases/phase-11.md`](phase-11.md)'s "Phase 11 follow-up decisions,
and AI-agent integration moved to Phase 12" Runbook entry for the full
account of why. Three of this phase's nine slices trace directly to a
2026-09-21 research memo
([`docs/research/ai-integration-2026-09-21.md`](../research/ai-integration-2026-09-21.md))
answering whether the extension can let a user plug an AI agent they already
have — Claude Code above all — into it, and to the decision that memo fed,
[ADR-0037](../adr/0037-ai-agent-integration-approach.md): 12a (the Agent
Skill), 12b (the Option C spike), and **12c**, added once 12b returned
viable/go to scope the actual Option C build the spike's own Runbook entry
recommended but did not do itself. 12d (formerly 11h, a Python-startup-
snippet spike) and 12e (CSV formula-injection guard research, carried over
from a Phase 11 (11d) follow-up) are unrelated in topic to the memo, but
share the same shape — a real open question that needs investigation before
it can be sized or built — which is why they sit alongside 12a–12c as
spikes/scoping rather than builds. **12f was added later the same day**, at
the Phase 11→12 between-phase housekeeping checkpoint — three
already-decided, already-scoped Phase 11 follow-ups that had a "build it"
call but no slice to land in; unlike 12a–12e, none of it traces to the
research memo and none of it is a spike, since nothing about any of the
three is actually undecided. **12g, 12h and 12i were added later the same
day too**, from two pieces of work that happened entirely outside this
repository: a hand-run of SAS's own VS Code extension (`SAS.sas-lsp`) in a
`.sasnb` notebook against a Viya 4 deployment, and a dependency-licence
inventory produced for an internal open-source-contribution request.
Neither traces to the research memo either. 12g and 12i are small and
bounded; 12h is a spike on exactly 12b's terms — it answers what is cheap
to answer and explicitly does not scope the build it might recommend.

**A letter collision, found and fixed the same day.** 12c and the trio
12g–12i were scoped in two sessions working this phase concurrently from
separate clones — this project's own established pattern (see
`CLAUDE.md`'s "Don't guess about Viya — probe it" section for why
finding numbers are phase-scoped for exactly this reason). Each session's
insertion was correct on its own branch, but both used the next free
letter after the same five-slice base, so 12c's own branch labelled the
three-follow-ups slice `12f` at the same moment the other branch's `#207`
merged a *different* slice under that same letter. Caught at merge time
(this file's own `12c scoped`/`12c audience boundary settled` Runbook
entries were still unmerged when `#207` landed), not after — resolved by
a uniform shift: `12c`'s own insertion point right after `12b` stands, and
every slice from the old `12c` onward (the pre-existing `12c`/`12d`/`12e`
*and* `#207`'s newly-merged `12f`/`12g`/`12h`) moves one letter later,
preserving each side's own relative ordering exactly rather than
re-litigating which slice belongs where. See this file's own "Letter
collision reconciled" Runbook entry for the full account.

This phase repurposes a number previously assigned to a different, unstarted
topic ("second execution backend"), renumbered the same day to
[Phase 13](phase-13.md) so it would not collide with this one.

**Sean's explicit call, 2026-09-22: this phase gates v1.0.** Recorded as an
amendment to `PRODUCTION_PLAN.md` §8's "Definition of done — 1.0" — see that
section for the exact wording. This is new, not a reversal of anything
previously said about this phase specifically — the phase did not exist
under this number before today.

1. **12a — Ship an Agent Skill (Option A).** Formerly 11f. A
   `.claude/skills/python-on-viya/SKILL.md` teaching an agent (Claude Code or
   VS Code Copilot agent mode — both read `.claude/skills/` verbatim, per the
   research memo's Finding 14) how this project's execution model actually
   behaves: upload-plus-`infile=` submission rather than inline `endsubmit;`,
   `SYSCC` as a session variable, the interpreter banner/`>>>` markers as
   inherent output rather than a defect (Finding 11.3, `phase-11.md`),
   library/CAS naming, what the environment probe reports, and the existing
   command surface. No production code — a day of writing, per the research
   memo's own estimate.
2. **12b — Spike: an in-process MCP server reachable by an external Claude
   Code session (Option C).** Formerly 11g. Exploratory only, not a
   commitment to build the feature: the narrow question is whether an
   external Claude Code CLI session can actually connect to a loopback HTTP
   MCP server run inside the extension host, with a token handed over out of
   band, and whether the server survives a VS Code window reload — neither is
   promised by any documentation (research memo, "What would have to be
   settled before any code", items 1–2). The spike's own outcome, recorded
   here once run, decides whether a real Option C build gets scoped as a
   later slice or the project falls back to Option B (`languageModelTools`
   over the existing pure adapters), which ADR-0037 holds pending exactly
   this result.
3. **12c — Scope the actual Option C build: the loopback MCP server's
   token/lifecycle story and tool surface.** Added 2026-09-22, once 12b
   returned viable/go. Per ADR-0037's own consequences section, the real
   build is "a separate, not-yet-scoped slice" — a spike answering "can this
   work" is not the same undertaking as building it production-ready — and
   12b's own Runbook entry recommends scoping it without doing so itself.
   This slice is that scoping: a design and punch list for a following,
   not-yet-numbered build slice, not the build itself — no `src/` code, the
   same footprint as the spike it follows. Settles the audience boundary
   (external CLI only for v1, vs. also reaching VS Code's own in-editor
   agents through `contributes.mcpServerDefinitionProviders`, which depends
   on the three things 12b re-confirmed are still undocumented), the tool
   surface (which read operations of `LibraryAdapter`/`CasAdapter` to
   expose, and whether `ExecutionBackend` belongs in v1 at all, given the
   difference in risk between reading metadata and running arbitrary
   Python), the token design (a `headersHelper`-shaped local secret fixing
   12b's own found gap — a static header token going silently dark on
   rotation), the port/window-reload story, and what a pre-code security
   review (ADR-0037's own named requirement) must cover. Outcome recorded
   here once run — see this file's own Runbook entry.
4. **12d — Spike: a Python startup snippet's submission mechanism and
   namespace survival.** Formerly 11h. Investigates, rather than builds, the
   idea (a Phase 11e follow-up) of a profile-level Python startup snippet —
   the Python analogue of 11e's SAS `sasOptions`/`autoExec`. Settles the
   submission path given
   [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md) (all Python
   reaches the interpreter as an uploaded file via `infile=`, never
   inlined) — is it its own job run at session-create time, alongside
   `autoExec`'s SAS lines, or something else; whether its effect (imports,
   variables) actually survives into the *first* real `Run File`/notebook-cell
   job the same way it already survives between two ordinary runs in one
   session (probably already implied by existing behaviour, but not
   specifically confirmed for a job submitted before any user code has run);
   and, the harder question, what **`proc python restart;`**
   (`RESTART_STATEMENT`, `src/backend/procPython.ts`) does to it — does
   **Reset Python Interpreter** silently drop it with nothing to tell the
   user their setup is gone, or does a reset need to re-run it automatically.
   Outcome recorded here once run; decides whether the startup-snippet idea
   gets sized into a real slice back in a future phase, or stays parked.
5. **12e — Research: does the CSV formula-injection guard need to cover SAS
   library exports too, and how.** Carried over from Phase 11's 11d
   follow-ups, 2026-09-22 — flagged as needing more research than a
   punch-list item implied, rather than a settled "build it, CAS-only" call.
   The CAS-only scoping (an opt-in setting, default off, prefixing a leading
   `=`/`+`/`-`/`@` character cell in `formatCsvPage`, `src/cas/csvFormat.ts`)
   left "should this also cover SAS library table CSV export?" as an
   explicit open question the original item never answered — the SAS
   library path relays the server's CSV untouched
   ([Finding 7.20](phase-7.md)), so guarding it means re-parsing every page,
   a real cost the CAS-only version doesn't pay. An opt-in setting that only
   protects some of a user's CSV exports risks the same silent-gap shape as
   11e's autoExec-error follow-up. This slice investigates the
   library-export cost/shape before anything is decided for either surface,
   rather than shipping the CAS-only version and leaving the library
   question open again.
6. **12f — Three small, already-decided Phase 11 follow-ups.** Folded in
   from `phase-11.md`'s own punch list at the Phase 11→12 between-phase
   housekeeping checkpoint, 2026-09-22 (see that file's own "Phase 11→12
   housekeeping" Runbook entry) — each already carried a "build it" decision
   from the same day, but no phase or slice to land in:
   - **Large-table CSV-export confirmation for SAS library tables.** Added
     to Phase 11's punch list 2026-09-19, at Sean's request.
     `CsvExportSource.confirmAboveBytes` (11d) already gates a CAS table's
     CSV export above an estimated 100 MB; `LibraryCsvSource` sets no
     threshold, so a SAS library table's export never asks. Needs a
     threshold and a probe of how a large Compute session table actually
     pages ([Finding 7.20](phase-7.md) only measured `SASHELP.CLASS`;
     nothing larger has been exported), then `confirmAboveBytes` set on
     `LibraryCsvSource` and manual-test items mirroring 11.19/11.20.
   - **A `CasProblem` for an oversized CAS response.** Added 2026-09-20,
     from the PR #197 review. `src/cas/client.ts` has no
     `ResponseTooLargeError` case, so a CAS page over the transport's 1 MiB
     cap (a very wide table's export or grid page) surfaces as
     `cas-unreachable` — proxy-troubleshooting advice, with the real cause
     only in the detail. Mirror `content-too-large`
     (`src/content/client.ts`, `problems.ts`, `messages.ts`): a dedicated
     variant carrying the cap, a message saying the table/page is too wide,
     and a test driving a real `ResponseTooLargeError` through `CasClient`.
     Then restore `docs/browsing-cas.md`'s "content too large" wording and
     the two comments in `csvFormat.ts`/`csvExportModel.ts` that 11d left
     pointing at this follow-up. Consider the same for the Compute/library
     client.
   - **Surface the text of an autoExec error.** Added 2026-09-20. A bad
     `autoExec` line leaves the session `idle` with `sessionConditionCode`
     3000 and the `ERROR` only in the session log
     ([Finding 11.7](phase-11.md)) — 11e's own message says only that an
     error occurred, not what it was. Read `/compute/sessions/{id}/log`
     after create when the code is nonzero and write the `ERROR`/`WARNING`
     lines to the output channel.

   Unlike 12a–12e, none of this traces to the AI-agent-integration research
   memo and none of it is a spike — each item is already scoped and decided,
   just never given a slice until this checkpoint. Sequenced after 12a–12e:
   those were this phase's original reason for existing (or grew directly
   out of it, 12c's own case), and 12f is Phase 11 leftover work riding
   along rather than this phase's own topic. (12g–12i, below, were added
   later still, from unrelated work — see this file's own "Letter collision
   reconciled" Runbook entry for why 12f does not sit last overall.)
7. **12g — Does `PROC PYTHON`'s "resuming state" `NOTE` reach our users, and
   is it ever wrong when it does?** Added 2026-09-22 from Finding 12.2, in
   this file's own Probe findings section below. SAS emits
   `NOTE: Resuming Python state from previous PROC PYTHON invocation.` at the
   `submit` statement when interpreter state survives between two
   `proc python` steps in one Compute session. That much only *confirms* the
   namespace-lifecycle model 12a's skill already documents; what it raises is
   about this extension's own transcript, and needs no Viya probe at all —
   run the extension and read the output channel:
   - **Does the `NOTE` survive `logFilter.ts`'s noise filter and reach the
     user?** On **Run File**, whose documented contract is a *fresh*
     namespace, a user who reads "Resuming Python state" immediately after we
     cleared globals would reasonably conclude the clear did not happen.
     Establish both whether the filter passes it and whether Run File's
     globals-clear runs before or after the step that emits it.
   - **Does it still appear on the first run after Reset Python State?**
     `proc python restart;` (`RESTART_STATEMENT`, `src/backend/procPython.ts`)
     tears down the interpreter process, so a "resuming" `NOTE` there would be
     flatly wrong on screen — a user-visible defect if it happens, nothing to
     do if it does not.
   - **Does it appear on the very first run in a brand-new session?**
     Presumably not, which would make its presence a cheap "the interpreter
     was already warm" signal — but build nothing on that without confirming
     it, since the absence of a `NOTE` is exactly the kind of thing a Viya
     release changes without announcement.

   Outcome recorded here, plus a manual-test item under
   `docs/dev/manual-tests/` (a Phase 12 file, if this is the first item to
   need one). A perfectly good result is "the filter already drops it,
   nothing to do" — the slice decides that, rather than assuming either way.
8. **12h — Spike: inline graphics (`SAS.show`) and where our own pieces
   already stand.** Added 2026-09-22 from Finding 12.3, below:
   `SAS.show(plt)` renders a `matplotlib` figure directly in a cell
   under SAS's own extension, and this extension surfaces no plot anywhere —
   not in the run transcript, not in the interactive window, not in `.ipynb`
   cell output. **Sean's explicit call, 2026-09-22: spike now, build
   deferred.** Settle the cheap blocking questions in this phase; any build
   they recommend is a separate, not-yet-scoped slice — the same boundary
   12b and [ADR-0037](../adr/0037-ai-agent-integration-approach.md) already
   set for Option C. Because this phase gates v1.0, *running* the spike is a
   1.0 gate; whatever it recommends building is not.

   **Two of the questions are already answered — by reading this
   repository's own source, not by probing — and they change the shape of the
   rest.** Recorded here so the spike starts from them:
   - **A graphics path already exists; what is missing is `SAS.show`'s
     ergonomics.**
     [ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)'s
     rich-output capture (`src/backend/richOutput.ts`, `src/compute/files.ts`)
     already diffs the session's files after every run, whitelists `.png` →
     `image/png` and `.html`/`.htm` → `text/html`, caps at 10 MiB, decodes,
     and both the result panel and a notebook cell already render both mimes.
     A `plt.savefig("fig.png")` therefore already reaches the user today. So
     the open question is not "can we display a figure" but whether an ODS
     body file lands where that same diff already looks — which would make
     this plumbing rather than a retrieval mechanism to invent.
   - **The sanitizer does not strip `data:` URIs. It does drop SVG, and
     that is the real constraint.** `src/notebook/htmlSanitize.ts` accepts
     `<img src>` only when the value matches
     `data:image/(png|jpe?g|gif|webp);base64,…`, and excludes `svg+xml`
     deliberately ("an SVG can carry its own `<script>`"); `<svg>` is not an
     allowed tag either, so an inline SVG element is dropped whole. ODS's
     `svg_mode='inline'` output would therefore vanish from a notebook cell
     while `bitmap_mode='inline'` output survives intact. **No
     [ADR-0036](../adr/0036-notebook-html-output-is-sanitized.md) relaxation
     is needed for the PNG path** — which removes the security decision this
     was expected to be blocked behind. What replaces it is an asymmetry
     worth confirming: the result panel sanitizes nothing and relies instead
     on a nonce-locked CSP with `img-src … data:`
     ([ADR-0021](../adr/0021-result-panel-webview.md),
     `src/run/resultPanel.ts`), so the same body file may render differently
     in the two surfaces.

   **Left for the spike:**
   - Does `SAS.show(plt)` execute at all under `proc python infile=`
     ([ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md)) with
     no ODS destination open — silently, with an error, or not at all? `SAS`
     is `PROC PYTHON`'s own bridge object rather than anything either
     extension implements, so it presumably already runs and simply has
     nowhere to put its output; that must be established, not assumed. SAS's
     notebook uses inline `submit;`/`endsubmit;`, a different mechanism.
   - With an `ods html5(id=…) options(bitmap_mode='inline')` destination
     opened around the run, where does the body file land, and does the
     existing rich-output diff capture it unchanged? Forcing PNG
     (`ods graphics / outputfmt=png`) is likely needed to keep the payload on
     the arm the sanitizer passes.
   - Does `SAS.show(df)` render a DataFrame as an ODS table by the same
     route, and do we want that given the Phase 7 data viewer? Decide
     deliberately rather than shipping a second way to look at a table
     because it arrived free.
   - The ODS preamble is noise to a Python developer *and* is the thing that
     makes graphics possible. Any design has to hold both; log presentation
     is already a defect class here, not output.

   No production code ships from the spike itself, same as 12b.
9. **12i — `NOTICE`: attribute the bundled third-party components.** Added
   2026-09-22. Found while producing a dependency-licence inventory for an
   internal open-source-contribution request — not by any review of this
   repository, which is why it had gone unnoticed. `package.json` declares no
   `dependencies` at all, so `npm ls --omit=dev` and every `--production`
   licence tool return an empty set and read as "this redistributes nothing"
   (`scripts/check-audit.mjs`'s own doc comment records the same emptiness
   independently, for the vulnerability gate's purposes). Twelve packages are
   redistributed anyway: `esbuild.mjs` statically inlines `react`,
   `react-dom`, `react-is`, `scheduler`, `prop-types`, `object-assign`,
   `loose-envify`, `js-tokens`, `ag-grid-community`, `ag-grid-react`,
   `ag-stack` and `ag-charts-types` into `dist/webview/dataViewer.js`, which
   ships in the `.vsix`. All twelve are MIT; AG Grid is the MIT Community
   edition and no Enterprise package appears anywhere in the tree.

   MIT asks for one thing — that the copyright notice and permission text
   travel with the copies — and today that happens only partly. esbuild's
   `legalComments` defaults to `eof` when bundling and this project does not
   override it, so the built `dataViewer.js` does end with a
   `/*! Bundled license information:` block; but it carries five
   React-family notices and nothing else, each pointing at a `LICENSE` file
   that does not travel with it, and the AG Grid packages ship no `@license`
   banner at all so esbuild has nothing to preserve for them. The root
   `NOTICE` covers the SAS-derived Apache-2.0 material thoroughly and says
   nothing about any bundled npm component.

   The work: append a "Bundled third-party components" section to `NOTICE`
   listing the twelve packages with their copyright lines and one copy of the
   MIT permission text. `NOTICE` already ships (it is not in
   `.vscodeignore`), so packaging does not change and no build step is added.
   Confirm the `legalComments` block against a `--production` build of
   `dataViewer.js` while there — the default is independent of `minify`, so
   it should be identical, but the bundle actually inspected was a
   development build and that should not be assumed away. **Out of scope,
   noted as the obvious follow-on:** a licence gate shaped like
   `scripts/check-audit.mjs` — an allow-list of SPDX identifiers checked
   against `package-lock.json` on every PR — which is what would keep this
   from drifting again. Not scoped here.

### Punch list

- [x] **12a — Agent Skill (Option A).** Shipped 2026-09-22, no production
  code, per the plan. See this file's own Runbook entry, below, for what the
  skill covers.
- [x] **12b — Spike: in-process MCP server reachable by an external Claude
  Code session (Option C).** Run 2026-09-22. Both headline questions
  answered — an external Claude Code session connects over loopback HTTP
  with an out-of-band token and completes a real tool call; a killed/
  restarted server is transparent to the CLI only if port and token are
  both stable, and a `headersHelper` is the documented, right-shaped fix for
  the case where the token isn't. Recommendation: viable, go, scoped next as
  12c — see this file's own Runbook entry for the full account and what's
  still open before a build slice can start.
- [x] **12c — Scope the actual Option C build.** Scoped 2026-09-22 — a v1
  design (external-CLI-only tool surface, read-only tools, a
  `headersHelper`-shaped local token) is ready to hand to a not-yet-numbered
  build slice. The audience-boundary call is fully settled, not just
  recommended: a live Extension Development Host probe the same day found
  VS Code's own core does discover an extension-registered MCP server
  automatically, but a VS Code core team member and a still-open
  `microsoft/vscode` issue (#265912) confirm that registration is
  currently invisible in every standard MCP management surface — a real,
  current product gap, not an unproven integration. See this file's own
  Runbook entries.
- [x] **12d — Spike: Python startup snippet submission/namespace survival.**
  Run 2026-09-23 — submission mechanism confirmed (a plain `infile=` job at
  session-create time, mirroring `autoExecLines`'s own role for SAS setup);
  its effect survives into the first ordinary run; **restart wipes it, and
  Run File always restarts — not only Reset Python State** (Finding 12.4).
  Viable, not parked; sizing it into a build slice is undecided. See this
  file's own Runbook entry.
- [x] **12e — CSV formula-injection guard, both surfaces.** Built 2026-09-23
  — researched the library-export cost the slice was scoped to settle, then
  built an opt-in `pythonOnViya.csvExport.guardFormulaInjection` guard
  (default off) covering both CAS and SAS-library CSV export. See this
  file's own Runbook entry.
- [ ] **12f — Three small, already-decided Phase 11 follow-ups.** Not
  started.
- [ ] **12g — Does the "resuming Python state" `NOTE` reach our users, and
  is it ever wrong?** Not started. Needs no Viya probe — run the extension
  and read the transcript, on Run File and after Reset Python State.
- [ ] **12h — Spike: inline graphics (`SAS.show`) / ODS HTML5.** Not
  started. Spike only; the build it may recommend is a separate,
  not-yet-scoped slice. Two of the four questions are already answered from
  source — see the Plan section above.
- [ ] **12i — `NOTICE`: attribute the twelve bundled MIT components.** Not
  started. Append a "Bundled third-party components" section; no packaging
  change.

### Bugs found in this phase

Numbered `B12.n`, separate from the probe findings; each links the finding
that establishes it. Not yet triaged for whether they are fixed in this phase
or scheduled elsewhere — that is Sean's call. Tick one when its fix merges.

- [ ] **B12.1 — A failed SAS step poisons the compute session, and Reset
  Python State cannot clear it.** Found 2026-09-23 (manual test 12.4). One
  SAS-side error, such as a `SAS.submit()` naming an unassigned libref, puts
  the session in syntax-check mode: `SYSCC`/`SYSERR` stay non-zero, so every
  later Run File and the extension's own `proc python restart;` report as
  failed with the old `SYSERRORTEXT`, even though the steps ran. Reset
  Python State logs `resetting the interpreter: the backend failed: <the old
  error>`. Only reconnecting (which discards libraries and filerefs)
  recovers it today. A clearing job — `options nosyntaxcheck obs=max;` then
  `%let syscc=0;` — cleared it in a probe. Evidence and open questions:
  [Finding 12.5](#finding-12-5-a-failed-sas-step-leaves-the-session-in-syntax-check-mode-syscc-syserr-stay-non-zero-every-later-job-reads-as-failed-and-reset-python-state-reports-the-old-error).
  No fix written; it touches `src/backend/procPython.ts`.
- [ ] **B12.2 — A CAS table's columns come back alphabetical while its row
  cells stay in table order, so CAS CSV export mispairs them.** Found
  2026-09-23 (manual test 12.4). Headers are swapped with the data under
  them, and the formula guard checks each cell against the wrong column's
  type — a text column read as numeric is trimmed and never guarded. The
  CAS data viewer's grid pairs columns and cells the same way, so it is
  affected too (by code reading; not seen live). Evidence:
  [Finding 12.6](#finding-12-6-a-cas-table-s-columns-listing-under-sortby-name-is-alphabetical-each-item-s-index-not-its-position-is-what-row-cells-follow). Fixed on the 12e branch
  (`CasAdapter.getColumns` re-sorts by each column's `index`); manual tests
  12.4 and 12.9 passed live against the fix, 2026-09-23. Tick when 12e
  merges.

---

## Runbook

### Phase 12 created, 2026-09-22

Repurposed from a stub previously numbered Phase 12 ("second execution
backend"), which had no content beyond a three-sentence plan paragraph and
was never started — renumbered to [Phase 13](phase-13.md) the same day, so
this number could hold a real, already-scoped body of work instead of
colliding with it. 12a/12b/12d are 11f/11g/11h, moved here unchanged in
substance (see `phase-11.md`'s own "Phase 11 follow-up decisions, and
AI-agent integration moved to Phase 12" Runbook entry for the full account
of what carried over and why); 12e is the CSV-guard research item, similarly
carried over from 11d's follow-ups. **12c did not exist at this point — it
was added later the same day, once 12b's spike returned viable/go; see this
file's own "12c scoped" entry, below.** None of the four has started as of
this entry.

### 12f added, 2026-09-22, at the Phase 11→12 between-phase housekeeping checkpoint

The housekeeping checkpoint (`phase-11.md`'s own "Phase 11→12 housekeeping"
Runbook entry) found that Phase 11's three remaining punch-list follow-ups —
large-table CSV confirmation for SAS library tables, a `CasProblem` for an
oversized CAS response, and surfacing autoExec-error text — each already
carried a same-day "build it" decision but no phase or slice to land in. A
first pass at the checkpoint described them as "carried forward as
documented open items," on the model of Phase 8a's own open items; that
comparison didn't hold, since Phase 8a's items are blocked on something
external (a stale credential, a not-yet-existing environment) and these
three are not blocked on anything — just unscheduled. Fixed by giving them a
slice, **12f**, in this phase rather than Phase 11 (which is otherwise
closed) or a new phase of their own — Phase 12 is the next phase starting
regardless, and none of the three needs its own investigation, so there is
no reason to hold them out of it. (Labeled **12e** at this checkpoint;
renumbered **12f** the same day, once 12c was inserted ahead of it — see
this file's own "12c scoped" entry.) None of the three has started as of
this entry.

### 12a shipped, 2026-09-22

`.claude/skills/python-on-viya/SKILL.md`, per the Plan section above — no
production code, matching the research memo's own estimate. Covers: the
upload-plus-`infile=` submission mechanism and why an inline-`submit`
escaping hazard doesn't apply here ([ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md));
`SYSCC` as the real success signal (`0`/`1012`/`3000`) rather than job/run
state; the interpreter banner and `>>>` prompts as inherent `PROC PYTHON`
noise, not a defect (Finding 93, `phase-5.md`; Finding 11.3, `phase-11.md`);
the three-way namespace-lifecycle distinction between Run File's fresh
namespace, Run Selection's namespace-sharing, and Reset Python State's full
interpreter restart; the one-thing-at-a-time execution model and Cancel's
inability to interrupt a step already running inside SAS; reading/writing
SAS library data via `SAS.sd2df`/`SAS.df2sd`/`SAS.submit` and the
never-write-a-credential-as-a-literal rule (`docs/data-access.md`);
connecting to CAS via `swat.CAS()` and FedSQL passthrough, both via their
own insert-snippet commands rather than a hand-written token literal
(`docs/cas-python-connection.md`); the environment probe's read-only scope
and cache behaviour (`docs/python-environment.md`); and the full
`pythonOnViya.*` command surface relevant to writing/running code. Reach is
both Claude Code and VS Code Copilot agent mode, since both read
`.claude/skills/` verbatim (research memo Finding 14).

Classified as a docs-only change per `CLAUDE.md`'s adversarial-review
section — it adds no source and changes no documented invariant, only
documents existing ones — so the mandatory pre-PR adversarial pass does not
apply. Sean asked for a manual review anyway, since the skill ships content
users will act on even though it is not code — see the next entry for what
it found.

### 12a manual review, 2026-09-22 — a distribution gap and two content bugs

Requested by Sean despite 12a's docs-only classification, since the skill's
content is something an agent will act on even though no source changed. Not
run as the project's usual pre-PR pass (that pass's review prompt is written
for TypeScript source and does not fit a skill file); done as a direct,
targeted check of each claim in the new file against its cited source —
ADR-0014, `phase-11.md`'s Finding 11.7, `phase-8.md`'s Finding 8.6, and
`src/backend/logFilter.ts`'s own doc comment. Three findings, all resolved
before this branch's diff was considered final:

1. **Distribution gap (the reason this file — `agent-skill.md` — now
   exists).** The skill has no path to an actual end user. `.vscodeignore`
   excludes `.claude/**` from the packaged `.vsix` outright (with its own
   comment: "None of it has meaning inside a published VSIX"), so installing
   the extension puts nothing in a user's agent. The research memo's own
   Option A text called for "document that users can copy it to
   `~/.claude/skills/`" — that documentation did not exist. Fixed by adding
   [`docs/agent-skill.md`](../agent-skill.md), wired into `.vitepress/config.mjs`'s
   sidebar and `docs/README.md`'s page list, with cross-links added from
   `getting-started.md` and `running-python.md`.
2. **`SYSCC` conflated with `sessionConditionCode` (fixed).** The skill's
   first draft illustrated `SYSCC=3000` with a broken profile-level
   `autoExec` line — but a bad `autoExec` line surfaces as
   `sessionConditionCode` (Finding 11.7, `phase-11.md`), a different,
   session-level field checked once at session creation, not the job-level
   `SYSCC` variable ADR-0014 defines. Would have sent an agent debugging an
   autoExec failure to check the wrong signal. Fixed, with an explicit line
   distinguishing the two added to the skill.
3. **An overstated credential-leak mechanism (fixed at the time; fully
   settled by a live probe the same day — see the next entry).** The first
   draft repeated `docs/data-access.md`'s claim that "the Python cell itself
   is echoed to the job log verbatim, unconditionally" as the reason never to
   write a credential literal. That claim appears to contradict ADR-0014 and
   `src/backend/logFilter.ts`'s own doc comment, both of which state as a
   probed, settled fact (finding 35) that `infile=` — the path every ordinary
   run uses — echoes no source at all; the one *confirmed* instance of this
   leak (Finding 8.6, `phase-8.md`) was through an inline `submit`/
   `endsubmit` block, a different mechanism. Fixed at review time by
   softening the skill's wording to state the actionable rule without
   asserting the disputed broader mechanism. **Left open at review time as a
   question needing a live probe — closed the same day; see Finding 12.1,
   below, and the Runbook entry after this one.**

Verification re-run after the fixes and the new page: `npx prettier --check`
and `node scripts/check-secrets.mjs` (528 files scanned) both clean on every
touched file; `npm run check:docs` (reference check, samples, self-link
check, VitePress build) run in full this time, since `agent-skill.md` sits
inside the VitePress tree — all four steps green, self-link count 14 → 16
(the two new GitHub blob links into `.claude/skills/.../SKILL.md` and
`docs/phases/phase-12.md` both resolve).

### 12a review's open credential-echo question, settled by probe, 2026-09-22

The manual review above (item 3) flagged a contradiction it could not
resolve by reading alone: ADR-0014/`logFilter.ts` say `infile=` echoes no
source; `docs/data-access.md`/`docs/cas-python-connection.md` say the
Python cell is echoed to the job log "verbatim, unconditionally." Settled by
a live probe the same day — Finding 12.1, below. Short version: ADR-0014 was
right about the outer Python cell (never echoed); `data-access.md` was wrong
about that but right about the underlying danger, which turned out to be
worse than its own wording said — `SAS.submit()`'s own argument is echoed,
and the "masks a `password=`" claim did not hold in the one case tested (a
`LIBNAME` statement that failed to parse came back with its password in
full plaintext). `docs/data-access.md` and `docs/cas-python-connection.md`
are corrected in the same commit as this entry, and the skill's own wording
(already softened at review time) is tightened further to state the
confirmed mechanism plainly rather than hedge. No adversarial-review
re-run was needed — this is a probe-driven correction to prose already
covered by the docs-only classification, not new source or a changed
invariant.

### 12b spike run, 2026-09-22 — Option C confirmed viable; go

Per the memo's own framing ("What would have to be settled before any
code"), these are VS Code/Claude Code CLI behaviours, not Viya wire
behaviour, so this is a spike, not a `viya-api-probe` entry, and lives in
the Runbook rather than Probe findings. No production code was written or
touched in `src/` — the spike ran entirely as a standalone Node script
outside the repository, per the phase's own "no production code ships from
the spike itself" scoping.

**Method.** Built a minimal loopback HTTP MCP server (`@modelcontextprotocol/sdk`
v1.30.0's `StreamableHTTPServerTransport`, one read-only tool
`list_libraries` stubbing `LibraryAdapter.listLibraries()`, bound to
`127.0.0.1` only, gated by a bearer-token middleware checking
`Authorization: Bearer TOKEN` before any MCP request is handled) — close
enough to Option C's proposed shape (an in-process server sharing the
extension's own live session and token) to answer the two questions the
memo flagged as genuinely undocumented. Registered it against this
session's own real `claude` CLI (v2.1.245, confirmed present on this
machine) exactly the way an end user would: `claude mcp add --transport
http sas-spike http://127.0.0.1:PORT/mcp --header "Authorization: Bearer
TOKEN"`. Every tool call below ran as a fresh, separate `claude -p
--allowedTools mcp__sas-spike__list_libraries "..."` process — a real
second Claude Code session, not this one, satisfying "external" in the
memo's question 1 literally rather than by analogy.

**Q1 — can an external Claude Code session connect and complete a tool
call? Confirmed, yes, first try.** `claude mcp list` reported
`✔ Connected`; a fresh `claude -p` process called
`mcp__sas-spike__list_libraries` and returned the tool's actual payload
(`["SASHELP","WORK"]`), round-tripped correctly. The server log confirms a
distinct MCP session was initialized per connecting process. A wrong or
missing `Authorization` header was rejected with a clean `401` before any
MCP handshake — the auth gate itself needs no MCP-level design.

**Q2 — does it survive a restart (standing in for a VS Code window
reload, which kills an in-process server the same way killing this spike's
process does), and what does Claude Code do when it doesn't? Answered in
three parts, and the answer changes the design, not just confirms a
gap:**

1. **Same port, same token:** fully transparent. Killed the process,
   restarted it with identical `SPIKE_PORT`/`SPIKE_TOKEN`, and a brand-new
   `claude -p` process reconnected and completed the tool call with no
   `claude mcp` command re-run at all. If a real build pins a stable,
   per-workspace port and keeps the bearer token stable across a reload
   (not tied 1:1 to a rotating Viya token), a window reload is invisible to
   an already-configured external session.
2. **Same port, rotated token, static `--header` (the config `claude mcp
   add --header` actually writes):** restarted the server with a
   different token, config unchanged. `claude mcp list` surfaced a
   specific, actionable error — `Server rejected the configured
   Authorization header (HTTP 401)… OAuth fallback is disabled when
   headers.Authorization is set` — but a fresh `claude -p` session run
   without first checking `mcp list` saw no error at all: the tool was
   silently absent from its toolset (`ToolSearch` reported "no matching
   deferred tools found"), same as if the server had never been
   registered. **This is the real gap**, and it's a UX one, not a
   protocol one: a static header cannot self-heal, and an agent mid-session
   has no signal that a tool it could use a moment ago is now gone — only a
   human running `mcp list` sees why.
3. **`headersHelper`, the documented fix for (2):** per Claude Code's own
   docs (`code.claude.com/docs/en/mcp`, fetched live 2026-09-22, not
   assumed from the memo) a `headersHelper` script re-runs on every
   connect, is retried once automatically on a `401`/`403`, and its output
   overrides a static `headers` entry with the same name — exactly the
   shape a per-connect, freshly-read Viya-scoped token needs. Configuring
   one (`.mcp.json`/`add-json`, `type: "http"`, `headersHelper:
   "SCRIPT_PATH"`) surfaced one more real, previously-undocumented-in-this-
   project behaviour before the live rotation test could run: Claude Code
   requires a one-time **interactive** workspace-trust acceptance before it
   will execute a `headersHelper` command at all — `headersHelper not run —
   this workspace has no persisted trust; accept the trust dialog here once
   interactively, or set projects[...].hasTrustDialogAccepted in
   ~/.claude.json`. This is Claude Code's *own* trust boundary, layered on
   top of and separate from VS Code's workspace trust (ADR-0002) — a real
   user hits this once, interactively, in their own terminal, and accepts
   it, which is unremarkable; it could not be driven further from this
   spike because accepting it means editing this very session's own
   `~/.claude.json`, which the harness correctly refuses as self-
   modification. **Not fully closed the loop live** (the actual
   retry-on-401 was not observed end-to-end, only documented), but the
   mechanism, its trigger conditions, and its one real prerequisite are now
   confirmed from primary sources rather than inferred.

**Also re-checked, no change from the memo:** questions 3–5 (whether
extension-provided MCP definitions are forwarded to VS Code's Agent Host,
whether the in-VS-Code Claude harness sees them, whether
`resolveMcpServerDefinition` re-runs on token expiry) remain undocumented.
A fresh check today (`code.visualstudio.com/docs/agents/reference/mcp-configuration`,
plus `microsoft/vscode-docs#10227`, filed 2026-09-02 and closed 2026-09-17 —
adjacent but about `chat.mcp.autostart` scoping, not this question, and it
doesn't answer it either) found the same gap the memo already recorded: the
docs say VS Code "forwards the servers you configure" and
"eligible server configurations from supported VS Code sources, including
`.vscode/mcp.json`" without ever stating whether an
extension-registered (`contributes.mcpServerDefinitionProviders`)
definition counts as one of those sources. These three remain genuinely
open and would need either a real Extension Development Host prototype or
a direct question to VS Code's team — out of scope for this spike's
few-hours budget, per the memo's own sizing.

**Decision: Option C is viable — go, with one design constraint and one
scope boundary, both carried forward rather than decided here.** The two
questions the memo said actually gate the choice (Q1, Q2) are both
answered, and answered favourably: an external Claude Code session
connects and works over loopback HTTP with an out-of-band token, and the
reload story — the part the memo called "awkward" — turns out to have a
documented, working mechanism (`headersHelper`) rather than being an open
problem, provided the build pins a stable port and treats the bearer token
as something a helper re-fetches per connection rather than something
baked into a static config at registration time. Per ADR-0037's own
consequences section, the actual Option C build is "a separate,
not-yet-scoped slice," not a continuation of this one — this entry
recommends scoping it, but does not scope or start it, and does not touch
`src/`. It also does not relitigate the ADR's own named condition: "a
loopback listener holding a Viya-scoped capability is a named security
review item... not folded into a slice's ordinary pass," which stands
exactly as written and applies in full to whatever slice picks this up.
**That scoping is 12c, added the same day** — see this file's own "12c
scoped" entry, below.

No verification commands apply — nothing in `src/`, `package.json`, or any
tracked file changed; the spike server, its `node_modules`, and every
`claude mcp` registration it created were run from and cleaned up in the
session scratch directory, never this repository.

### 12c scoped, 2026-09-22 — Option C build design and one open decision

Per this slice's own Plan entry, produced once 12b returned viable/go. No
`src/` code — this is a design and punch list for a following, not-yet-
numbered build slice, the same "no production code" footprint 12b itself
kept. Grounded in this session's own read of `src/data/adapter.ts`
(`LibraryAdapter`), `src/cas/adapter.ts` (`CasAdapter`), and
`src/backend/backend.ts` (`ExecutionBackend`), not written from
ADR-0037/the research memo alone.

**Audience boundary — settled: external CLI only for v1.** 12b proved the
external-CLI path (`claude mcp add --transport http ...` against a
loopback server) end to end, with no dependency on any VS Code API.
Reaching VS Code's own in-editor agents (Copilot chat, the in-VS-Code
Claude harness) instead or additionally would go through
`contributes.mcpServerDefinitionProviders`, which 12b left as three
undocumented open questions. First recorded here as a recommendation held
open for Sean's own confirmation rather than settled by this pass; Sean's
own reply asked how to decide it at all with no documentation to read —
the right answer, per this project's own "probe it" posture
(`CLAUDE.md`), was to stop reasoning from absent docs and go empirical,
the same way 12b itself did for the CLI path. See the next entry, below,
for the live Extension Development Host probe that settled it the same
day: not merely undocumented, but confirmed — by a VS Code core team
member, on a still-open issue — as current, by-design behaviour that
makes the in-editor path a real product gap today, not just an open
question. **This is a scope decision with product-visible consequences
(which agents actually reach the extension), and it is now settled with
primary-source evidence, not a guess.**

**Tool surface — v1 is read-only; execution is a separate, later
decision.** `LibraryAdapter` (`getLibraries`/`getTables`/`getColumns`/
`getRows`/`getRowsAsCsv`) and `CasAdapter` (`getServers`/`getCaslibs`/
`getTables`/`getColumns`/`openTable`/`getTableProperties`/`getRows`) are
already `vscode`-free, read-only seams — exactly the shape ADR-0037 called
"almost for free." `LibraryAdapter.applySort`/`deleteView` create and
delete a server-side view as a means to an end, never user data, and can
reasonably ride along; `CasAdapter` has no analogous mutation at all.
`ExecutionBackend` is a different order of risk: exposing it hands an
agent the ability to run arbitrary Python against the user's live Viya
session, not merely read metadata, and nothing in 12b's spike touched it
(the spike's own tool, `list_libraries`, was chosen specifically because
it was read-only). Recommendation: v1's tool surface is the read-only
library/CAS browse-and-page operations only, each marked with MCP's
`readOnlyHint`; execution is named as an explicit, separately scoped and
separately reviewed follow-up, never folded into this build by default.

**Token/lifecycle design — a `headersHelper`-shaped local secret,
independent of the Viya token.** Per 12b's finding 2/3, a bearer token
pinned into a static `claude mcp add --header` config cannot self-heal
and goes silently dark to an agent mid-session with no signal — the real
gap 12b found. Design: a local, per-workspace secret that gates loopback
access to this project's own MCP server, unrelated to and never derived
from the user's Viya OAuth token (the loopback listener's own
Viya-scoped *capability* is the adapters behind it, not the local auth
secret itself) — generated fresh per server start, held the same way
this project already holds sensitive material (`SecretStorage`,
`src/auth/sessionStore.ts`'s own precedent) rather than written to a
config file in plaintext, and served to an external session via a
`headersHelper` script the build slice generates alongside the
`claude mcp add`/`add-json` command it hands the user to run — never a
value the user copy-pastes into a static `--header` by hand, which is
exactly the shape 12b found cannot recover from a rotation.

**Port and window-reload story.** A stable, per-workspace port, allocated
once and persisted for that workspace (not re-rolled every VS Code
launch, which would break an already-registered external session the
same way a rotated token does) and scoped so two VS Code windows open
against two different Viya deployments do not collide on the same port —
`TableSource`'s own cross-deployment isolation precedent (ADR-0034) is
the closest existing analogue, though the exact mechanism (a per-workspace
port derived from the workspace's own storage path, vs. an OS-assigned
ephemeral port surfaced through the generated `headersHelper`/`add`
command each time) is left to the build slice itself to decide, not fixed
here.

**Security-review checklist, per ADR-0037's own named requirement.** The
consequences section calls this "a named security review item, not
folded into a slice's ordinary pre-PR pass" the moment any code beyond
the spike is written — this scoping pass is not that review, but lists
what it must cover once the build slice exists: the server binds
loopback-only (`127.0.0.1`, never `0.0.0.0`); the token design above,
specifically that the local secret cannot be recovered or guessed from
anything network-visible; the exact adapter operations exposed, with
particular scrutiny on `applySort`/`deleteView`'s view-creation side
effects even though they are not user-data mutations; and workspace trust
(ADR-0002) gating server start and token issuance, not merely tool
execution. This review runs once the build slice's diff exists, before
that slice's own PR — not before this scoping is confirmed, and not
folded into this scoping pass itself, per the ADR's own wording.

**Outcome: scoping complete, all decisions settled.** The tool-surface,
token, port, and audience-boundary designs above are ready to hand to a
build slice as written — the audience boundary that started as an open
recommendation is now settled with primary-source evidence (see the "12c
audience boundary settled" entry, below), not merely asserted. No
verification commands apply: no `src/`, `package.json`, or other tracked
source file changed, only this phase file's own Plan/Runbook/punch-list.

### 12c audience boundary settled, 2026-09-22 — an Extension Development Host probe

Run the same day as 12c's own scoping, once Sean asked how the
audience-boundary question could be decided at all with nothing
documented — the right move was to probe VS Code's own behaviour
directly, the same "stop guessing, run it" posture this project already
applies to Viya (`CLAUDE.md`'s "Don't guess about Viya — probe it"),
turned on VS Code's own undocumented API surface instead. No `src/` code
— a throwaway extension and loopback server, built and run entirely in
the session scratch directory and torn down afterward, the same footprint
12b's own spike kept.

**Method.** A minimal extension (`package.json` declaring
`contributes.mcpServerDefinitionProviders`, one provider registered via
`vscode.lm.registerMcpServerDefinitionProvider`) instrumented to log every
callback VS Code invoked on it, pointed at a loopback HTTP server
(`127.0.0.1:39217`) that logged every request it received and could answer
a real `initialize`/`tools/list`/`tools/call` JSON-RPC handshake. Loaded
into a real Extension Development Host (`code --extensionDevelopmentPath=…
--new-window`, workspace trust pre-accepted via
`--disable-workspace-trust` for this throwaway scratch folder — VS Code's
own analogue of the interactive trust prompt 12b hit on the Claude Code
CLI side) against the actual locally installed `anthropic.claude-code`
extension (no Copilot Chat extension is installed in this environment, so
that specific surface was not directly reachable this pass).

**Finding 1 — VS Code's core does query an extension-registered provider,
unprompted, confirmed empirically.** `provideMcpServerDefinitions()` fired
the moment the extension activated — no chat opened, no command run, no
human interaction at all. This is a real, first-hand answer to the first
of 12b's three open questions: yes, an extension-registered definition is
forwarded to VS Code's own management layer automatically.

**Finding 2 — that registration is invisible in the standard MCP UI, and
this is confirmed as current, deliberate VS Code behaviour, not a probe
artefact.** Sean checked the running Extension Development Host directly:
`MCP: List`, `Add`, and `Browse` were all present in the Command Palette;
`MCP: Show Installed Servers` was not, and the registered server ("SAS
EDH Probe") surfaced nowhere he looked — an observation of this build
only, and a broader claim than anything the upstream issues below
actually assert. Calling
`workbench.mcp.startServer`/`workbench.mcp.listServer` from inside the
extension itself (several guessed argument shapes) returned cleanly but
triggered nothing observable — `resolveMcpServerDefinition()` was never
called, and the loopback server never received a request beyond a manual
`curl` sent before the probe ran. A live, current (checked 2026-09-22)
search of `microsoft/vscode`'s own issue tracker explains why directly,
from a VS Code core team member, on an issue reporting exactly this
symptom:

> "The MCP panel there only shows user-installed/uninstall MCP servers.
> It does not show MCP servers from extensions."
> — [connor4312 (VS Code team), microsoft/vscode#258549](https://github.com/microsoft/vscode/issues/258549#issuecomment-3136834057)

That issue was closed as a duplicate of
[microsoft/vscode#265912](https://github.com/microsoft/vscode/issues/265912)
("MCP servers added via McpServerDefinitionProvider should display in the
MCP Servers list") — **still open, unresolved, as of this check** — filed
by an outside extension author, not by the VS Code team, and then taken
up by it: assigned to a VS Code team member and placed on the Backlog
milestone, which is what makes it a tracked gap rather than an unanswered
report. The corroborating comment from a Microsoft engineer on another
team (`joshfree`), noting their own Azure MCP server hits the identical
confusion — "it appears only VSIX-installed mcp servers are 'penalized'"
— is on #258549, alongside the quote above; #265912 itself carries no
comments at all. (Both attributions re-checked against the GitHub API,
2026-09-22.)

**Decision, settling the question 12c's own Plan entry left open: build
against the external-CLI path only for v1.** This is stronger than the
original recommendation's reasoning (avoid three undocumented unknowns) —
it is now a confirmed, current product gap, tracked by VS Code's own team
as unresolved: an extension-registered MCP server does not appear in the
installed-servers surface — the Extensions-sidebar MCP list and
`MCP: Show Installed Servers` — which is exactly where VS Code sends a
user to trust, start, stop or remove one. **That is the whole of what the
upstream issues establish**, and it is narrower than what this probe
observed: #265912's own reproduction steps still have the server
reachable from `MCP: List Servers`. Building the in-editor path now would
mean shipping a server a user cannot manage through the UI VS Code points
them at — not merely an unproven integration, an actively bad one.
Revisit `contributes.mcpServerDefinitionProviders` as a real option only
once microsoft/vscode#265912 (or its eventual resolution) closes; until
then this stays out of scope, not held open. **Not settled by this
probe**: whether a chat participant could technically still call a tool
from an unlisted, unmanageable server despite the UI gap (no Copilot Chat
extension was installed to test against, and it does not change the
decision above either way — an invisible, unmanageable server is not
something to ship regardless of whether a tool call would technically
succeed).

No verification commands apply — nothing in `src/`, `package.json`, or
any tracked file changed; the probe extension, its loopback server, and
every VS Code command/window it touched were built and run entirely from
the session scratch directory and torn down after (loopback server
process killed; the throwaway Extension Development Host window is not
part of this repository and needs no cleanup here).

### Letter collision reconciled, 2026-09-22 — 12c inserted, 12f–12h from `#207` shifted to 12g–12i

Found while finishing 12c's own scoping: `#207` ("add 12f/12g/12h —
resuming-state NOTE, graphics spike, NOTICE attribution") merged into
`main` at 02:11 UTC the same day, from a session working this phase
concurrently from a separate clone — this project's own established
pattern for working phases in parallel (`CLAUDE.md`'s "Don't guess about
Viya — probe it" section explains why probe findings are phase-scoped
rather than a single global counter for exactly this reason; slice
letters had never collided this way before, but the underlying hazard is
the same one). Both sessions independently reached for the next free
letter after this phase's original five-slice base (12a–12e): this
session's own branch labelled its new build-scoping slice's neighbours
`12d`/`12e`/`12f` (shifting the pre-existing `12c`/`12d`/`12e` down one
each to make room for the new `12c`), while `#207`'s branch — scoped
before this session's own `12c` existed, working from that same
five-slice base — merged three genuinely new slices as `12f`/`12g`/`12h`.
Neither branch could have seen the other's letters before merging; this
was caught only when this session rebased onto the post-`#207` `main` and
found `12f` claimed by two unrelated slices (three Phase 11 follow-ups on
one branch, the resuming-state `NOTE` investigation on the other).

**Resolved by a uniform shift, not by re-litigating either side's
ordering.** `12c`'s own insertion point — immediately after `12b`, since
it exists only because `12b`'s spike returned viable/go — stands as
originally placed. Every slice from the old `12c` onward, `#207`'s newly
merged trio included, moves exactly one letter later, preserving each
side's own relative order intact: `12c`(old)/`12d`(old)/`12e`(old) become
`12d`/`12e`/`12f`, and `#207`'s `12f`/`12g`/`12h` become `12g`/`12h`/`12i`.
This was chosen over resequencing by topic (for instance, moving the
Phase-11-leftover slice — originally reasoned to sit "last" among the
first five — past `#207`'s three newer slices too) because that would
require this session to make a judgement call about `#207`'s own content
that was not this session's to make; a uniform shift changes only what
had to change to remove the collision.

**What changed, concretely:** this file's Plan section (the numbered list,
its intro paragraph, and the "sequenced last" closing note on the
Phase-11-follow-ups item), the punch list, and every Runbook entry that
named a shifted letter (`Phase 12 created`, the `12e`→`12f`-added entry,
`#207`'s own `12f, 12g and 12h added` entry, now `12g, 12h and 12i
added`) were swept in this same pass. `phase-11.md` needed no further
change beyond what this session had already done for its own `12d`/
`12e`/`12f` renumbering — it was never touched by `#207` and does not
reference `12g`/`12h`/`12i` at all. `STATUS.md` was swept the same way, in
the same pass. Probe Finding 12.2/12.3's own in-body mentions of `12f`/
`12g` (as slice pointers, not finding numbers) were corrected to `12g`/
`12h` to match.

No source or invariant changed by this reconciliation itself — it is a
letter renumbering across already-committed prose, the same shape as this
project's own 2026-09-09 finding-numbering-scheme change and the Phase
12→13 rename, both precedent for sweeping every cross-reference rather
than leaving some stale. Verification: `npx prettier --check`,
`node scripts/check-secrets.mjs`, and a full `npm run check:docs` re-run
(including the self-link check, since several of the renamed headings are
link targets) after every edit in this pass, before this branch is pushed.

### 12g, 12h and 12i added, 2026-09-22 — provenance, two decisions, and what was settled without probing

**Where they came from.** Two pieces of work ran outside this repository on
2026-09-22, and each left something this phase should carry rather than lose.
The first was a hand-run of SAS's own VS Code extension (`SAS.sas-lsp`) in a
`.sasnb` notebook against a Viya 4 deployment — a comparison exercise, not a
defect hunt — which produced the two log fragments now recorded as Findings
12.2 and 12.3. The second was a dependency-licence inventory produced for an
internal open-source-contribution request, which turned up an attribution gap
in `NOTICE` that no review of this repository had ever looked for. Both were
held in a project-folder scratch file rather than committed while they were
still only questions, per `CLAUDE.md`'s Runbook-hold rule; this entry is that
file's reconciliation, and it is now marked as such rather than left to the
next housekeeping checkpoint to rediscover.

**Decision 1 (Sean, 2026-09-22): graphics get a spike now, and the build is
deferred.** The alternative considered was scoping a build directly off the
observation, which would have meant sizing a retrieval mechanism and a
sanitizer change before knowing whether either was needed — and, as it turns
out, at least one of them is not. 12h therefore answers the cheap blocking
questions and stops, exactly the boundary 12b drew for Option C: it may
recommend a build, it does not scope or start one. Because this phase gates
v1.0, running the spike is itself a 1.0 gate; nothing it recommends building
becomes one by implication.

**Decision 2 (Sean, 2026-09-22): the `NOTICE` gap becomes its own punch-list
item**, rather than staying a note in the licence inventory or riding along
inside some other slice. It is a real, if small, compliance obligation with a
known fix, and an item nobody has to remember is worth more than a
well-written note somebody has to find.

**Two of 12h's four questions were settled here, by reading this
repository's own source rather than by probing — and the result is better
than expected.** The scratch note called the sanitizer "the gotcha that
decides the whole thing," on the reasonable assumption that a `text/html`
sanitizer strips `data:` URIs and that relaxing it would be a security
decision needing its own ADR. It does not: `src/notebook/htmlSanitize.ts`
already accepts `<img src="data:image/(png|jpe?g|gif|webp);base64,…">`
specifically, mirroring the `img-src … data:` directive ADR-0021 applies to
the result panel's CSP. What it does reject is SVG — `svg+xml` is excluded
from that pattern on purpose, and `<svg>` is not an allowed tag — so ODS's
`svg_mode='inline'` output would disappear from a notebook cell while
`bitmap_mode='inline'` output survives. The constraint moved from "a security
decision" to "force PNG," which is a setting on an `ods graphics` statement.
The second was the assumption that retrieving the body file off the session
is unprobed and probably hard; ADR-0019's rich-output capture already diffs
the session's files after every run and already whitelists `.htm`/`.html`
and `.png`, so the real question is narrower — whether the body file lands
where that diff already looks. Recorded as reasoning, not as findings:
neither was measured against a deployment, and both are claims about this
repository's own source, which the next reader can check directly.

**Where the graphics item is *not* recorded.** The scratch note proposed it
belonged on `phase-11.md`'s new-feature-candidates list alongside F1/F6/F11.
It is deliberately not filed there. Phase 11 is closed, this session is not
the one working that file, and `CLAUDE.md` is explicit that a discovery in
one phase gets referenced from its own phase rather than written into
another's — a rule this project has already paid for twice in merge
conflicts. A slice in the open phase is the better home regardless, since the
decision was to actually run the spike, not to park the idea.

Docs-only: this entry, the Plan section's three new slices, the three
punch-list boxes, Findings 12.2/12.3, and `STATUS.md`'s Phase 12 paragraph
and row. No source, no changed invariant, nothing inside the VitePress tree —
so `CLAUDE.md`'s mandatory pre-PR adversarial pass does not apply, and
verification is `npx prettier --check` on the two touched files plus
`node scripts/check-secrets.mjs`.

### 12d spike run, 2026-09-23 — submission path confirmed; the restart gap is bigger than Reset Python State alone

Per this slice's own Plan entry: investigates, rather than builds, the
profile-level Python startup-snippet idea (11e's Python analogue). No `src/`
code — the same footprint as 12b/12c. Method and full results are Finding
12.4, below, from a live `viya-api-probe` run against `verde`. The mutating
calls it needed (a throwaway session, three filerefs, three jobs, all
deleted/settled within the run) were described to Sean and approved before
they ran, per this project's own "ask before mutating" rule — a step this
session initially skipped by running the probe script unasked and was
stopped by the harness's own permission classifier before any request
reached Viya; the script was then described and approved before being
re-run.

**Outcome: the submission mechanism is settled.** A plain (non-restart)
`proc python infile=<fileref>; run;` job, submitted once right after session
creation, is the right shape for a startup snippet — it mirrors
`autoExecLines`' own session-create-time role for SAS-side setup
(`src/profile/sessionSetup.ts`, `src/compute/sessionManager.ts`), needs no
[ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md) exception
(still upload + `infile=`, never inlined), and Finding 12.4 proves its effect
is genuinely readable in a later job — not merely plausible from the
"Resuming" `NOTE` alone.

**The restart question resolved differently than the Plan scoped it.** The
Plan's own wording asked whether **Reset Python State** silently drops the
snippet. It does — but so does every **Run File**, unconditionally: `Run
File`'s `ExecuteOptions.freshNamespace` is `true` with no condition a
startup-snippet feature could hook into (`src/run/commands.ts:500`), which
`src/backend/procPython.ts:986-988` turns straight into `proc python restart
infile=...;` — the exact statement Finding 12.4's third job sent. A design
scoped only around an explicit Reset would leave the single most common
first action after connecting — Run File — starting from a namespace with no
trace of the profile's setup, silently, every time.

**Recommendation for a future build slice, not built here:** re-inject the
snippet's own lines into the uploaded file's bytes on every
`freshNamespace: true` job (Run File, and Reset Python State's own
restart-only statement), rather than running it as a separate follow-up job.
That survives every restart by construction and touches no path that already
preserves the namespace (Run Selection, a notebook cell, the interactive
window — `freshNamespace: false` throughout, per
`notebookController.ts:389-392`), which need the snippet seeded only once, at
session creation. This is a shape for whoever sizes the build to start from,
not a commitment this spike makes on its own.

**Decision: viable, sizeable into a future slice — carried forward as an
open, not-yet-scheduled idea**, the same status 12d already had before this
spike, now with the actual mechanism confirmed empirically rather than
assumed from ADR-0014 alone. Whether it is worth a slice of its own is
Sean's call, same as every other unscheduled Phase 12 item.

No verification commands apply beyond this phase file's own touch: no
`src/`, `package.json`, or other tracked source file changed. The probe
session and everything created in it were built and torn down entirely
against `verde` — cleanup `DELETE` returned `204`, and a follow-up `GET` on
the session id returned `404`.

### CAS-token reusability, 2026-09-23 — a design candidate, not a slice

Raised from the same customer-support investigation as the correction above,
and placed here rather than a new punch-list item because 12d — the Python
startup-snippet spike — is this candidate's natural consumer and otherwise has
none. Nothing here is decided or scoped; it is exactly the kind of "open,
not-yet-scheduled idea" 12d's own outcome already carries.

**The problem.** `pythonOnViya.insertCasConnectionSnippet` (8b) writes the
CAS token into a fileref named `CT` plus six random digits and inlines that
literal name into the snippet it inserts. Fine for occasional, one-off use — 8b
was never scoped for anything else — but it does not survive contact with
anyone developing reusable code: the filename (and the host/port baked in
alongside it) changes every invocation, so nothing using it can be committed,
imported, or shared, and getting a working connection requires a manual
palette command every session — a per-session ritual for someone iterating,
and structurally impossible for a module or shared notebook meant to run
unattended.

**On "point to a stored token" — the shape is right, the mechanism isn't.**
Sean's own framing was to have an option point at a stored token. Two things
worth separating: a stored token does not buy longevity — a token this
extension writes and one a user mints by hand are the same kind of SASLogon
OAuth access token, so swapping one for the other changes nothing about how
long either lasts (only a refresh token, a longer `access_token_validity`
client registration, or a client-credentials grant would, and each of those is
the customer's own SASLogon configuration, not something this extension
decides). And a token at rest is a step backwards from 8b's own design, which
exists specifically so a credential never lands anywhere a user handles it
(Finding 8.6, Finding 12.1). What "point to somewhere" is really asking for is
a stable, well-known location user code can reference unconditionally — the
fix is to keep that location fresh, not to make the user manage a token.

**Options, none decided:**

1. **A stable fileref name**, replacing the random `CT######` with a fixed
   one. Cheap and not blocked by anything load-bearing —
   `src/compute/casToken.ts`'s own doc comment already says the random suffix
   is collision avoidance, not security, and Finding 12.10 (above) now
   confirms a fileref can be rewritten in place under a fixed name with
   nothing deassigned or deleted, so `src/compute/fileref.ts`'s never-deassign
   invariant holds. Does not fix the host/port baking or the per-session
   command.
2. **Provision the token automatically at connect**, so the well-known name
   from Option 1 always exists with no command run. Real cost: two extra
   Compute calls per connect, and a token in every session's run directory
   whether or not that session ever touches CAS — a genuine, if small,
   widening of the exposure window versus today, where it only lands when a
   user explicitly asks for it.
3. **A refresh path** for a stale file — piggyback on the run path, a
   dedicated command, or a session-side helper re-reading the file each call.
   **Finding 12.9 (above) settles this is an optimisation, not a requirement**:
   a held CAS connection outlives its token, so a stale file only matters to
   code that reconnects later in the same session.
4. **A session-side helper** (`conn = viya_cas_connect()`), delivered by 12d's
   own startup-snippet mechanism — no filename, no host, no port, fully
   portable source. Inherits 12d's own blocker: Finding 12.4 found every Run
   File sends `freshNamespace: true` unconditionally
   (`src/run/commands.ts:500`), which would wipe a seeded helper on a user's
   very first run. Cannot ship ahead of that being solved for 12d itself.
5. **A setting naming the fileref**, not storing a token — the useful residue
   of Sean's original suggestion, so a team can standardise on a name their
   shared modules reference. No credential at rest, composes with 1–3.

**What was probed, and what's still open.** U1 (does an open connection
survive token expiry) and U4 (can a fileref be rewritten under a stable name)
are both settled — Findings 12.9 and 12.10. U2 (this extension's own client's
token lifetime) is partial: the only lifetime measured belongs to
`sas.launcher`, not the `vscode` client this extension borrows, so it isn't
evidence for our own client's number. U3 (does SASLogon issue this extension's
client a refresh token) and U5 (does `swat.CAS()` accept a token from a
different OAuth client) are unprobed.

**Not proposed:** no code, and nothing here should be read as a build
decision. Whoever sizes this into a slice should treat Option 1 (now backed by
Finding 12.10) as the cheap floor, Option 3 as optional rather than required
(per Finding 12.9), and Option 4 as blocked on 12d's own `freshNamespace` gap
rather than a separate undertaking.

### 12e built, 2026-09-23 — the research settled the cost, and the guard shipped for both surfaces

Per this slice's own Plan entry, the open question was whether the
CAS-only formula-injection guard (briefly decided "build it, CAS-only" at
the Phase 11→12 boundary, then pulled back into research once the
CAS-vs-library asymmetry was raised — see `phase-11.md`'s "Phase 11 follow-up
decisions" entry) should also cover a SAS library table's CSV export, and at
what cost. No live Viya probe was needed — this is a question about this
project's own source and about spreadsheet-application behaviour, not wire
behaviour, so it was settled by reading `src/data/csvExportModel.ts`/
`src/cas/csvFormat.ts` and by checking OWASP's own CSV-injection writeup
(https://owasp.org/www-community/attacks/CSV_Injection, fetched live) rather
than assumed.

**What the research found.** CAS's own CSV export (`src/cas/csvFormat.ts`)
already builds every cell from JSON, one at a time, so guarding it is a
same-shape addition to work it already does — no new cost. A SAS library
table's export (`src/data/csvExportModel.ts`) relays the server's own
already-quoted `text/csv` response untouched, by design (Finding 7.20) — the
real cost the Plan asked about is that guarding it means parsing that
response back into fields with a correct RFC-4180 grammar (a quoted field can
itself carry a comma or a literal newline; a naive `split` would misplace
every column after the first such field) and re-encoding it, which this
project had no code for. **The harder finding wasn't cost, it was
correctness**: OWASP's own recommended fix — prefix a triggering cell with a
leading `'` rather than deleting the character — matters here specifically
because a numeric column's own leading `-` (a negative value) is not a
formula-injection risk at all, and guarding it anyway would silently turn a
number into text the moment the setting is on. Both APIs report a column's
type, so the guard is scoped to a character column only (`CHAR`/`VARCHAR` for
a SAS library table, Finding 7.14, `phase-7.md`; `char`/`varchar` for CAS)
— a complete partition, since a SAS variable is one of exactly two base
types, never a heuristic with a silent third case.

**Decision: build it for both surfaces**, an opt-in setting
(`pythonOnViya.csvExport.guardFormulaInjection`, default `false`, `window`
scope) rather than parking the library half again — leaving it CAS-only
would repeat the exact "protects some exports, not others, silently" shape
this slice exists to avoid (the same reasoning 11e's autoExec-error
follow-up already established for a different setting).

**What shipped:**

- `src/data/csvFormulaGuard.ts` (new, `vscode`-free) — `isTextColumnType`
  (the shared char/varchar partition, case-insensitive) and
  `escapeCsvFormula` (OWASP's leading-`'` prefix for a cell beginning with
  any of `=`, `+`, `-`, `@`, tab, CR, or LF — the ASCII subset of OWASP's own
  set; see "Adversarial review, before push" below for why the trigger set
  widened from the four originally shipped), shared by both surfaces.
- `src/data/csvParse.ts` (new, `vscode`-free) — a full RFC-4180 field-grammar
  parser (`parseCsvPage`) for the library side's re-guard step, and `csvField`
  (RFC-4180 quoting), moved here from `src/cas/csvFormat.ts` and re-exported
  from there for that module's own existing callers/tests — the single
  canonical definition now lives in `src/data`, which `src/cas` already
  depends on elsewhere (`casCsvSource.ts` imports `../data/csvExportModel`),
  rather than a second copy forcing a reverse dependency.
- `src/cas/csvFormat.ts` — `formatCsvPage` takes an added
  `guardFormulaInjection` parameter (default `false`); cheap, since it
  already builds every cell itself. `src/cas/casCsvSource.ts`/
  `src/cas/casExplorer.ts` thread the setting through.
- `src/data/libraryCsvSource.ts` — the default, untouched-relay path
  (`exportTableToCsv`) is completely unchanged when the guard is off, byte
  for byte; only when it is on does `open` pay one extra `getColumns` request
  (for the column types the guard needs) and does `sample`/`stream` route
  each page through `parseCsvPage` → guard → `csvField` instead of relaying
  it raw. `src/data/csvExportCommand.ts`/`src/data/dataExplorer.ts` thread
  the setting through the same way.
- The header row is never guarded on either surface — a column name is
  metadata, not exported row data, matching the CAS side's pre-existing
  behaviour.
- `package.json`/`package.nls.json` — the new setting,
  `docs/reference/settings.md` regenerated (`npm run docs:reference`).
  `docs/browsing-sas-libraries.md`/`docs/browsing-cas.md` — the existing
  "the file is written as Viya returns it" warning (from 11d) now also names
  the setting as the fix.

**A real bug found and fixed during testing, before this branch was
considered done.** `LibraryCsvSource.sample()` called its own `guard()`
helper unconditionally, with no gate on `this.guardFormulaInjection` — unlike
`stream()`, which only takes the parse-and-reguard path when the setting is
on. Since `this.columns` stays empty when the guard is off (`open` only
populates it when the setting is on), every field's column-type lookup fell
through to the method's own defensive `?? true` fallback and guarded
everything regardless of the setting — the exact opposite of the "byte for
byte untouched by default" guarantee this slice is built around. Caught by
the integration test for that exact claim (`library-csv-source.test.ts`,
"sample is relayed untouched when the guard is off"), which failed the first
time it ran. Fixed by moving the off-switch into `guard()` itself
(`if (!this.guardFormulaInjection || csvPageText === "") return csvPageText;`)
so there is one place the no-op path is guaranteed, not two call sites that
each have to remember it.

**Adversarial review, before push.** The manual pre-push pass
(`CLAUDE.md`'s required review) found six things, two of them landing before
the branch was ever pushed:

1. **The trigger set was a citation defect and a real bypass.** The comment
   called `FORMULA_TRIGGER`'s four characters (`=+@-`) "OWASP's own
   formula-triggering character set," but OWASP's page
   (https://owasp.org/www-community/attacks/CSV_Injection) lists seven —
   those four plus tab, CR, and LF — because a tab-prefix mitigation was
   itself the vulnerability in Symfony's CSV export (CVE-2021-41270): a
   naive `=/+/-/@`-only check missed a formula hiding behind a leading tab
   that Excel still evaluated on open. **Fixed**: `FORMULA_TRIGGER` widened
   to `/^[=+@\t\r\n-]/`, the doc comment corrected to name the real set and
   cite the CVE, and the full-width CJK variants OWASP also lists recorded as
   explicitly out of scope rather than silently dropped. New unit test in
   `data-csv-formula-guard.test.ts` covers all three added characters.
2. **The user-facing apostrophe claim overstated what the mitigation
   guarantees.** `docs/browsing-sas-libraries.md` said the value "looks the
   same once opened, only its interpretation changes" — OWASP's own page
   notes this technique is not reliable in Excel after a save/reopen cycle.
   **Fixed**: reworded to state the guarantee this guard actually makes
   (never evaluated as a formula) rather than a visual-identity claim it
   cannot make for every spreadsheet program; the manual-test item covering
   this (12.2) reworded to match, and a new item 12.8 added for the tab
   case.
3. **A dead `undefined` branch in `csvParse.ts`'s hot loop**, added only to
   satisfy `noUncheckedIndexedAccess` and unreachable by construction, sat
   oddly against this file's own 100/100/100/100 coverage claim for that
   module. **Fixed**: `text[i]` replaced with `text.charAt(i)`, which is
   never `undefined`, removing the branch (and the suppression comment)
   entirely rather than explaining it away.
4. **The library-side empty-page sentinel's coupling to Finding 7.20 was
   implicit.** `LibraryCsvSource.guard()`'s `csvPageText === ""` check only
   stays correct because Finding 7.20 established the server's line endings
   are a bare `\n`; if that ever changed, a page consisting solely of
   dropped characters could parse to zero rows and trip
   `streamCsvPages`'s end-of-table sentinel early. **Fixed**: a comment at
   that check now names the coupling explicitly. Judged low-severity (not
   reachable against the probed deployment) but cheap, so folded in rather
   than deferred.
5. **Test gaps**: every guard-on stream test exercised `guard()` only with
   `includeHeader === true`, missing the second-page path where a parsed row
   0 is data, not a header, and the exact case the off-by-one
   `isHeaderRow = includeHeader && rowIndex === 0` line exists to get right;
   no test covered a row with more fields than `this.columns.length` (the
   `?? true` fallback); the `csvParse` round-trip case list omitted `"a\rb"`,
   the one field where parsing and encoding treat `\r` asymmetrically
   (preserved inside quotes, dropped outside) — it round-trips correctly,
   it just wasn't asserted. **Fixed**: all three added to
   `library-csv-source.test.ts`/`data-csv-parse.test.ts`.
6. **Two adjacent same-typed boolean parameters** (`formatCsvPage(columns,
   rows, includeHeader, guardFormulaInjection)`) are transposable with no
   type error, and one call site in `cas-csv-format.test.ts` already reads
   that way. **Not fixed this pass** — an options-object refactor would
   touch `formatCsvPage`'s signature and every call site
   (`casCsvSource.ts`, `casExplorer.ts`, their tests), which is scope beyond
   a review-finding fix; flagged for whoever next touches that signature,
   not scheduled as its own slice. A related doc-wording issue in the same
   finding — `browsing-sas-libraries.md` justifying the setting's
   off-by-default with a reason (extra request cost) that doesn't hold for
   CAS, which is also off by default with no such cost — **was** fixed,
   folded into finding 2's edit above: the doc now leads with the real
   reason (don't silently change what the server returned) and keeps the
   extra-request detail as a SAS-library-specific aside.

**Verification (post-review).** `npx tsc --noEmit` and `npx tsc -p
tsconfig.test.json --noEmit` clean; `npm run lint` clean (the
`noUncheckedIndexedAccess` finding from the first pass is gone now that
`csvParse.ts` uses `text.charAt(i)`); `npm run test:unit` (1,878 passing, one
more than the first pass — the new tab/CR/LF `escapeCsvFormula` cases) and
`npm run test:integration` (509 passing, two more than the first pass — the
multi-page-guard and overflow-column tests) both green; `npm run coverage`
green (96.41/95.86/96.2/96.41 lines/branches/functions/statements — branch
coverage improved slightly over the first pass; `csvFormulaGuard.ts` and
`csvParse.ts` both still 100/100/100/100, this time genuinely, not against a
dead branch); `npm run check:copyright` (320 files)/`check:secrets` (533
scanned)/`check:coverage-scope`/`check:contracts`/`check:docs` (reference,
samples, self-links, VitePress build) all clean. Manual-test items 12.1–12.8
in `docs/dev/manual-tests/phase-12.md`, not yet run live.

No Probe findings entry: nothing here depends on Viya wire behaviour, and
Finding 7.14 (cited above, for the SAS-library column-type vocabulary) was
already settled in `phase-7.md` before this slice started.

### 12e manual test 12.4 failed, 2026-09-23 — CAS columns were mispaired with their cells; fixed

Sean's manual pass ticked 12.1–12.3 and 12.5–12.8 against a SAS library
table. 12.4, the same checks against a CAS table, failed twice in a row:
the `name` and `age` columns' data were swapped under their headers, and no
cell was guarded — not `=a,b`, not the formula-shaped names.

**One defect caused both.** `CasAdapter.getColumns` reads the table's
`casManagement` `columns` collection through `collectPages`, which adds
`sortBy=name` to every collection it reads (Finding 8.9, for stable
paging). That returns the columns alphabetically — `age`, `name` — while
every `rows` reply's positional `cells` stay in the table's own order —
`name`, `age`. `formatCsvPage` pairs the two by position, so the header
read `age,name` over `name,age` data, and each cell was checked against the
other column's type: the text column was treated as `double` (trimmed,
never guarded) and the numeric one as `varchar` (guarded, but a number never
triggers). The probe that settled it is
[Finding 12.6](#finding-12-6-a-cas-table-s-columns-listing-under-sortby-name-is-alphabetical-each-item-s-index-not-its-position-is-what-row-cells-follow);
the bug is **B12.2**.

This bug predates 12e — it is 8a's `sortBy=name` meeting 8c/11d's
positional pairing — but nothing noticed it until now. `columns.json`, the
fixture every CAS test uses, lists `CODE` then `VALUE`, which is both
alphabetical and table order, so no test could tell the two apart.

**Fix.** `getColumns` now re-sorts the collected items by each one's
1-based `index` before reading them; an item with no numeric `index` sorts
after every indexed one, in listing order. Paging keeps `sortBy=name` —
Finding 8.9 confirmed that sort stable across repeated requests; `sortBy=
index` was accepted too, but was only probed on one page of a two-column
table. Since the CAS data viewer's grid (8c) and the CAS tree's column
nodes use the same `getColumns`, both now show table order too — the tree
used to list columns alphabetically.

**Tests.** `test/unit/cas-adapter.test.ts`: index order over the listing's
order, and the no-`index` fallback (including a `null` item and a string
`index`). `test/integration/cas/csv-export-and-properties.test.ts`: 12.4's
own two columns in the live listing's order, exporting `name,age` with
`"'=a,b"` guarded and `-5` untouched. Manual item **12.9** added for the
viewer and tree.

**Verification.** `npx tsc --noEmit` and `npx tsc -p tsconfig.test.json
--noEmit` clean; `npm run lint` clean; `npm run test:unit` 1,880 passing
(two new); `npm run test:integration` 510 passing (one new, run from a
clean `out/`); `npm run coverage` green (96.42/95.87/96.21/96.42).

**Live re-run, 2026-09-23.** Sean re-ran 12.4 and the new 12.9 against a
build carrying the fix; both passed. Every Phase 12 manual item, 12.1–12.9,
is now ticked.

**Second adversarial pass, before push, 2026-09-23.** Because the fix added
source after the first pass, the whole branch was reviewed again before it
was pushed. The pass found nothing to fix. It confirmed that the `index`
re-sort is stable and orders items with no `index` last, and that the guard
stays opt-in on the library side. It also noted that the library-side
`getColumns` (`src/data/adapter.ts`) does not force `sortBy=name`, so it is
not exposed to B12.2. That is an existing behaviour, not a defect, and needs
no change here.

### `docs/cas-python-connection.md` corrected, 2026-09-23 — a customer-reported ingress failure, a refuted token-lifetime claim, and two supporting probes

Not tied to any lettered slice — a customer support investigation, the same
shape as 12a's own review-driven correction to this file (Finding 12.1). Two
questions came in together, from the same call: a `swat` connection failing
with `Expecting value: line 1 column 1 (char 0)`, and whether CAS becomes
unusable once the Viya access token that opened it expires. Both were run
down against `verde` from Python inside a compute session, through the
connected `sas-viya-mcp` tooling rather than a `viya-api-probe` run — each
finding below says so and states what that limits it to. A related design
question (making the CAS-token snippet reusable across sessions, rather than
a one-shot file the user re-inserts every time) came out of the same
investigation — see this file's own "CAS-token reusability" entry, below,
placed alongside 12d at Sean's own direction.

**The ingress failure was never a query or a credential problem.** The
customer had hand-minted a bearer token and pointed `swat` at a REST/HTTP URL
built on the deployment's public ingress, from Python already running inside
a Viya compute session — so the request went out the front door and tried to
come back in, and the front end answered `403` with an HTML error page before
CAS ever saw it. `swat` parses a connection response as JSON without checking
the status code first, so the HTML became the JSON-decode error the customer
actually saw. Finding 12.8 measures what a bad credential looks like on
`verde`'s own CAS HTTP route (always JSON, always `401`, never `403`, never
HTML) — read-only, and it cannot reproduce the customer's own ingress, which
fronts with a different stack. Finding 12.7 is incidental, from reproducing
the customer's original pass-through query on the binary path: a fully
successful FedSQL call returns `severity = 1`, not `0`, because of CAS's own
multi-node warning.

**The token-lifetime claim in this file was backwards.** This page previously
said an authentication error after a session had been open "for a while" was
"almost certainly an expired token" — uncited, and traced to the Phase
10→11 documentation catch-up rather than to any measurement. Finding 12.9
holds a `swat` connection open for over an hour, past its token's own expiry,
with a control proving the token had genuinely expired (a *second*, new
connection with the same token is refused in the same instant the held one
keeps working): CAS authenticates once, at connect, and a held connection is
unaffected by the token that opened it aging out. The "Reconnecting after a
while" section is rewritten to say that, and to stop asserting a lifetime in
minutes — the only number actually measured (`sas.launcher`'s own token, 3600
seconds) belongs to a different OAuth client than the one this extension
borrows, so inverting it to "hours" would be no better sourced than the wrong
number it replaces.

**Finding 12.10 is unrelated to either page edit** — it settles whether a
Compute fileref can be rewritten in place under a fixed name rather than a
fresh, randomly-named one every time, the mechanism the separate,
not-yet-placed reusability design depends on. Recorded here because it is a
Viya wire measurement like the other three, not because it changes anything
this file says.

No source changed and no documented invariant changed beyond this file's own
prose — this entry, the two section rewrites in
[`docs/cas-python-connection.md`](../cas-python-connection.md), and Findings
12.7–12.10 below. Verification: `npx prettier --check` on both touched files,
`node scripts/check-secrets.mjs`, and `npm run check:docs` (reference check,
samples, self-link check, VitePress build) run in full, since
`cas-python-connection.md` sits inside the VitePress tree.

---

## Probe findings

Findings in this file are numbered `12.x` — phase-scoped per `CLAUDE.md`'s
numbering rule, continuing nothing from any other phase. Finding 12.1 came
from a `viya-api-probe` run; 12.2 and 12.3 did not, and each says so and
states what that limits it to.

### Finding 12.1 — `infile=` echoes no Python source at all; a `SAS.submit()` `LIBNAME` statement is echoed unmasked when it fails to parse

Probed 2026-09-22, via `viya-api-probe`/`creds.json` against `verde`, using a
throwaway compute session (SAS Studio compute context, `id`
`05543858-66ad-4715-b14a-41e0565fb4bd`) created and deleted within the
probe — deletion confirmed by a follow-up `GET` on the session returning
`404`.

**Documented/claimed, in tension:** ADR-0014 (finding 35) and
`src/backend/logFilter.ts`'s own doc comment state that `infile=` "echoes no
source" at all. `docs/data-access.md` and `docs/cas-python-connection.md`
stated the opposite for the *outer* Python cell — "the Python cell itself is
echoed to the job log verbatim, unconditionally, regardless of
`SAS.submit()`" — and that `SAS.submit()` "masks a `password=` value the
same way SAS always does when it echoes a `LIBNAME` statement."

**Method:** Uploaded a fileref (`probe01`) containing:

```python
_outer_secret = "OUTER_FAKE_CRED_9f3a7b21c4"
try:
    SAS.submit('libname _probelib nosuchengine user=probeuser password=INNER_FAKE_CRED_7d2e91ab55;')
except Exception as e:
    print("submit raised:", e)
print("probe done")
```

Ran it the ordinary way (`proc python infile=probe01;` / `run;`, the same
two-statement job `src/backend/procPython.ts` sends), then read the job's
raw log directly (`GET .../jobs/{id}/log`) and searched for both fake
strings. Both credential values are fabricated and were never real
secrets.

**Observed:**

- The outer cell's own line — `_outer_secret = "OUTER_FAKE_CRED_9f3a7b21c4"`
  — **never appears anywhere in the log.** Confirms ADR-0014/finding 35 in
  full: `infile=` echoes no source, for the whole file, not merely the
  wrapping `proc python` statement.
- The `SAS.submit()` argument **is echoed**, as a `source`-typed log line,
  character-for-character: `libname _probelib nosuchengine user=probeuser
  password=INNER_FAKE_CRED_7d2e91ab55;` — **including the password in full
  plaintext, with no masking applied** — immediately followed by SAS's own
  parse error (`ERROR: _probelib is not a valid SAS name.` / `ERROR: Error
  in the LIBNAME statement.`).
- `SYSCC` read `0` afterward — the Python `try`/`except` caught the raised
  exception, and the SAS-side `LIBNAME` error did not propagate to it.

**Verdict:** `data-access.md`/`cas-python-connection.md`'s claim about the
*outer* Python cell being echoed is **refuted — the opposite is true**,
matching ADR-0014. Their claim that `SAS.submit()` masks a `password=`
value is **also refuted, for this statement shape** — the password leaked
in full plaintext, not merely "narrowly masked." Both docs, and the skill
this phase shipped (12a), are corrected in the same commit as this finding.

**Not settled:** whether a `LIBNAME` statement that parses successfully (a
valid libref name, a real engine) is masked differently before failing
later — at authentication, say. This statement failed at the naming/parse
stage, before any engine-specific or password-handling code would run, so
this probe does not establish that a well-formed statement leaks the same
way — only that a malformed one does, and that no masking can be assumed as
a safety net either way.

### Adversarial review of the whole branch, 2026-09-22 — one real defect found and fixed

Requested by Sean before this branch is pushed, covering all three of the
above entries together (the skill, `agent-skill.md`, the probe correction),
not just the original skill file. Same shape as the earlier manual review —
a direct, targeted check of each claim against its cited source, since the
project's standard TypeScript review prompt doesn't fit a docs-only diff.

**One real defect, fixed:** `docs/agent-skill.md` told users that Copilot
reads skills from `.github/skills/`/`~/.copilot/skills/` "in place of the
`.claude/` paths" — implying a second copy was needed for Copilot. That
directly contradicts the research memo's own Finding 14 and ADR-0037's
reason for shipping this as one file rather than two: Copilot reads
`.claude/skills/` and `~/.claude/skills/` **directly**, the same locations
Claude Code does. A user following the original wording would have done
unnecessary duplicate work, or worse, have concluded a `.claude/skills/`-only
copy doesn't reach Copilot at all. Fixed: the page now states one copy
covers both agents, and names `.github/skills/`/`~/.copilot/skills/` only as
locations Copilot *additionally* scans, not a required second destination.

**Also fixed, cosmetic:** an unwrapped, over-long source line in the skill's
CAS section (introduced by an earlier find-and-replace edit), split back
into normal paragraph width. No rendering defect — prettier passed
throughout — just inconsistent with the file's own style.

**Checked and found clean:** the compute-context UUID recorded in Finding
12.1 above, against this project's own scrubbing rule — precedent already
exists (`phase-2a.md`, `phase-2b.md`, `phase-3.md` all record Viya
correlator/session ids, which are equally opaque and non-identifying); no
real hostname, username, or token fragment from the probe session reached
any committed file (checked by grepping the full diff for the actual host,
the account's real email, and a token prefix — all clean); the small
wiring diffs (`docs/README.md`, `getting-started.md`, `running-python.md`,
`.vitepress/config.mjs`) all read correctly; `STATUS.md`'s phase-index row
and narrative paragraph match what actually shipped.

Verification re-run after the fix: `npx prettier --check` on both changed
files and `npm run check:docs` (reference check, samples, self-links,
VitePress build) both clean.

### Finding 12.2 — `PROC PYTHON` announces that it resumed interpreter state between steps in one session

Observed 2026-09-22. **Not from a `viya-api-probe` run**: this came from
hand-running SAS's own VS Code extension (`SAS.sas-lsp`) in a `.sasnb`
notebook against a Viya 4 deployment and reading the SAS log that notebook
displayed. The method bounds what follows — the code path is SAS's inline
`submit;`/`endsubmit;`, not this project's `proc python infile=`
([ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md)), and the
log is the one SAS's extension chose to show, not a raw
`GET .../jobs/{id}/log`.

**Observed**, at the `submit` statement of a second Python cell run in the
same session:

```
36   proc python;
37   submit
NOTE: Resuming Python state from previous PROC PYTHON invocation.
37 !       ;
```

**What it establishes.** Interpreter state — imports, globals — survives
between separate `proc python` steps within one Compute session, and SAS
announces the reuse rather than doing it silently. That is a *confirmation*
of the namespace-lifecycle model 12a's skill already documents (Run
Selection, an interactive-window cell and a notebook cell all build on what
earlier runs left behind; Run File clears globals first; Reset Python State
restarts the interpreter), not a discovery, and nothing in that model changes
on the strength of it.

**What it does not establish.** Anything at all about this extension.
Whether the `NOTE` survives `src/backend/logFilter.ts`'s noise filter and
reaches a user, whether it is emitted the same way under `infile=`, whether
it appears after `proc python restart;` — where it would be flatly wrong —
and whether it appears on a session's very first run are all open; that is
12g's whole content. It is also no evidence about stability: nothing here
says the wording or the presence of this `NOTE` is the same across Viya
releases.

No deployment-identifying detail appears in the fragment above; the numbers
are the notebook's own line numbering.

### Finding 12.3 — SAS's own extension opens a named ODS HTML5 destination, images inlined, before any user code runs

Same session, same method, and the same caveats as Finding 12.2 — observed
by hand-running SAS's extension, not by a `viya-api-probe` run.

**Observed**, in the preamble emitted ahead of the cell's own code:

```
33   ods graphics on;
34   ods html5(id=vscode) style=Ignite options(bitmap_mode='inline' svg_mode='inline');
NOTE: Writing HTML5(VSCODE) Body file: sashtml2.htm
```

With that destination open, `SAS.show(plt)` on a `matplotlib` figure rendered
a visible plot in the notebook cell.

**What it establishes.** SAS's extension opens a *named* (`id=vscode`) HTML5
destination before every run, so it can find its own output without colliding
with an `ods html5` the user wrote themselves. `bitmap_mode='inline'` and
`svg_mode='inline'` are the load-bearing options: they make ODS embed images
as base64 `data:` URIs *inside* the body file instead of writing sibling
image files. That distinction only matters because the server is remote — a
referenced image file is a server-side path the editor cannot fetch, whereas
an inlined one travels with the HTML. And the body file is an ordinary file
written into the session (`sashtml2.htm`), not a special results channel.

**What it does not establish.** That `SAS.show` behaves the same under
`proc python infile=`; where the body file lands relative to the directory
[ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)'s
rich-output diff already watches; or whether `SAS.show(df)` takes the same
route for a DataFrame. Those are 12h's questions. It is also not evidence
about `PROC PYTHON` in isolation: `SAS` is the procedure's own bridge object,
but everything ODS-side here was set up by SAS's extension, not by the
procedure.

**Related, from this repository's own source rather than from the log** —
recorded as reasoning in the Runbook entry above, not as a finding, because
nothing about it was measured against a deployment: the notebook sanitizer
(`src/notebook/htmlSanitize.ts`) already passes an inline
`data:image/png;base64,…` in an `<img src>` and already rejects SVG, so the
`bitmap_mode='inline'` half of this preamble targets the arm that survives
and the `svg_mode='inline'` half targets the arm that does not.

### Finding 12.4 — a startup-snippet job's namespace effect survives the first ordinary run; `restart infile=` (Run File's own statement) destroys it completely

Probed 2026-09-23, via `viya-api-probe`/`creds.json` against `verde`, using a
throwaway compute session (SAS Studio compute context) created and deleted
within the probe — deletion confirmed by a follow-up `GET` on the session
returning `404`. Approved by Sean before the mutating calls ran (session
create, fileref create/upload, job create, session delete — all against
throwaway objects), per this project's own "ask before mutating" rule.

**Documented/claimed, in tension:** 12d's own Plan entry asked whether a
Python startup snippet's effect (imports, variables) "actually survives into
the *first* real `Run File`/notebook-cell job the same way it already
survives between two ordinary runs in one session (probably already implied
by existing behaviour, but not specifically confirmed for a job submitted
before any user code has run)," and separately, what `proc python restart;`
does to it — framed around **Reset Python State** specifically.

**Method:** Three `proc python` jobs in one fresh session, each built exactly
as `src/backend/procPython.ts`'s `runProgram` composes them — upload a
fileref, submit `[<statement>, "run;"]` as one job, read `SYSCC` after:

1. `proc python infile=PY000001;` (no restart) — the very first `PROC
   PYTHON` invocation in the session — running:

   ```python
   _startup_marker = "STARTUP_STATE_7f2c91"
   import statistics as _startup_alias
   print("startup ran")
   ```

2. `proc python infile=PY000002;` (still no restart), running a script that
   reads `_startup_marker` and calls `_startup_alias.mean([1, 2, 3])`.

3. `proc python restart infile=PY000003;` — exactly the statement
   `ExecuteOptions.freshNamespace: true` builds
   (`src/backend/procPython.ts:986-988`), which is what **every** Run File
   sends (`src/run/commands.ts:500`), not a statement synthesized for this
   probe — running the same read-back script as job 2.

**Observed:**

- Job 1 completed, `SYSCC=0`. No "Resuming" `NOTE` — nothing to resume from
  yet, matching Finding 12.2's prediction for a session's very first run, now
  confirmed under `infile=` specifically rather than under SAS's own
  extension's inline `submit`.
- Job 2's log carried `NOTE: Resuming Python state from previous PROC PYTHON
  invocation.` at the `submit`, then `marker= STARTUP_STATE_7f2c91` /
  `alias_mean= 2` — both the variable and the aliased import read back
  correctly. `SYSCC=0`.
- Job 3's log carried `NOTE: Previous Python state destroyed.`, then two
  `NameError`s — one for `_startup_marker`, one for `_startup_alias` — both
  caught by the script's own `try`/`except`, so `SYSCC=0` even though the
  namespace was empty.

**Verdict:** Both halves of 12d's open question are settled, and the second
one resolves wider than the Plan's own wording anticipated. The submission
mechanism works and its effect is provably readable, not merely inferred,
in a later ordinary job — including for the specific case the Plan flagged
as unconfirmed, a job run before any user code has executed. But the
destructive statement is not specific to Reset Python State: it is the exact
statement **Run File always sends**, unconditionally. A design that only
re-seeds the snippet after an explicit Reset would still leave a user's very
first Run File starting from a namespace with no trace of it, silently, every
time — a materially larger gap than "Reset Python State needs to re-run it."

**Not settled:** whether the "Resuming"/"destroyed" `NOTE`s above reach a
user's own transcript through `logFilter.ts`'s noise filter — that is 12g's
own question (Finding 12.2), not reprobed here. Nor is anything established
about a large or slow startup snippet's cost, or about `SYSCC`/
`SYSERRORTEXT` if the snippet itself raises.

No deployment-identifying detail appears above; the fileref/job names and
compute-context label are this project's own fixed choices, not anything the
deployment assigned.

### Finding 12.5 — a failed SAS step leaves the session in syntax-check mode: `SYSCC`/`SYSERR` stay non-zero, every later job reads as failed, and Reset Python State reports the old error

Found 2026-09-23 while running manual test 12.4: a `SAS.submit()` of
`data casuser.test; …` failed with `Libref CASUSER is not assigned.` (the
compute session has no `casuser` libref; SWAT/CAS needs none). Every later
Run and a **Reset Python State** then failed with that same message, even for
code that never touched a libref — the log showed `resetting the
interpreter: the backend failed: Libref CASUSER is not assigned.`

Probed the same day via `viya-api-probe`/`creds.json` against `verde`, three
throwaway compute sessions (SAS Studio compute context), each deleted within
the probe (`DELETE` → `204`, follow-up `GET` → `404`). `SYSCC`, `SYSERR` and
`SYSERRORTEXT` were read through the session's `variables` link with a name
filter, the same way `src/compute/variables.ts` does.

**Documented/assumed:** ADR-0014 and `src/compute/variables.ts` treat `SYSCC`
as live session state and `procPython.ts`'s `reset()`/`readSyscc()` read it
once per job as that job's own result. Nothing in `src/` ever resets it, and
no earlier finding says a failed step's value carries into the next job
(Finding 70's "stale default" is a different case).

**Observed:**

- After a failing `data casuser.test; x=1; run;`: `SYSCC=1012`,
  `SYSERR=1012`, `SYSERRORTEXT='Libref CASUSER is not assigned.'`, job state
  `error`.
- A **clean** `data _null_; run;` in the next job: job state `error`,
  `SYSCC=3`, `SYSERR=3`, `SYSERRORTEXT` unchanged. Its log shows the step
  ran normally — the failure is entirely in the session's status, not in the
  step. `proc python restart; run;` after the failure: identical, so a
  successful restart is reported as failed.
- `%let syscc=0;` alone (own job) reads back `SYSCC=0`, but `SYSERR` stays
  `3`, and the very next step sets `SYSCC` back to `3`. `%let syserr=0;`
  fails with `Attempt to assign a value to a read-only symbolic variable
  (SYSERR).` `%let syscc=0;` in the same job as the restart does not help
  either.
- **What did clear it:** `options nosyntaxcheck obs=max;` followed by
  `%let syscc=0;` in its own job. Afterwards a clean step read `SYSCC=0`/
  `SYSERR=0` with job state `completed`, and `proc python; submit; print(1)
  endsubmit; run;` ran and read `SYSCC=0`, output `1`.

**Verdict:** Confirmed. `SYSCC` is not per-job in a compute session: one
SAS-side error (not a Python exception — those are caught and leave
`SYSCC=0`, Finding 12.1) puts the session in syntax-check mode, and until
that is cleared every subsequent job — including the extension's own
`proc python restart;` — reads as failed and reports the stale
`SYSERRORTEXT`. Reset Python State cannot recover the session, which is the
opposite of what a user reaches for it to do. Connecting again (a new
session) does, but discards libraries and filerefs.

**Not settled:** which of `nosyntaxcheck` and `obs=max` is the necessary
half (only the pair was tried); whether a Python cell's own outcome is
misreported the same way after a failure (`runProgram` reads the same
`SYSCC`, so it should be, but a real `infile=` run was not probed in the
failed state — only an inline `proc python; submit;` after the clear); and
whether autoexec/`sasOptions` set `obs`/`syntaxcheck` differently on other
deployments. Probed against `verde` only. No fix is written: the likely
shape (a clearing job before each restart and before each run's own `SYSCC`
read, or surfacing "session needs clearing" to the user) touches
`src/backend/procPython.ts`, so it is a decision for Sean, not part of 12e.

No deployment-identifying detail appears above.

### Finding 12.6 — a CAS table's `columns` listing under `sortBy=name` is alphabetical; each item's `index`, not its position, is what row `cells` follow

**Probed 2026-09-23, read-only, `verde` (Viya 4),** against manual test
12.4's own table — `casuser.test`, loaded, 7 rows, a `varchar` column
`name` and a `double` column `age`, created in that order by
`conn.upload_frame`.

- `GET` the table's `casManagement` `columns` link, no sort: `name`
  (`index: 1`), then `age` (`index: 2`).
- The same `GET` with `sortBy=name` — what `CasAdapter.collectPages` sends
  (Finding 8.9): `age` (`index: 2`), then `name` (`index: 1`).
- The same `GET` with `sortBy=index`: `200`, `name` then `age`.
- The table's `rows` (reached through its `dataTable` link's `302`, Finding
  8.14), `limit=3`: `cells: ["=SUM(A1:A9)", "          12"]` — `name`
  first, in `index` order.

Every column item carried a numeric, 1-based `index` alongside `version`,
`name`, `type`, `rawLength`, `formattedLength`, `numberFormatLength`,
`numberFormatDecimals` and `indexed`.

**Documented / previously recorded:** Finding 8.12 found `rows` cells line
up with the Data Tables API's own `columns` collection — a different
collection from the `casManagement` one `getColumns` reads, so it is not
contradicted here. Finding 8.9 recorded that every collection
`collectPages` reads, columns included, accepted `sortBy=name`; accepted,
yes, but for columns the result is no longer the order the cells use.

**Verdict:** Confirmed, and it is the root cause of manual test 12.4's
failure (**B12.2**). Any CAS table whose column names are not already in
alphabetical order had its CSV headers mispaired with its data, and the
formula guard judged each cell by the wrong column's type. The fix sorts by
`index` on the client and keeps `sortBy=name` for paging.

**Not settled:** whether `index` is ever missing (not seen; the fix sorts
an item without one last, in listing order); a table with more than one
page of columns; and deployments other than `verde`.

No deployment-identifying detail appears above.

### Finding 12.7 — a successful FedSQL pass-through returns `severity = 1`, not `0`

Observed 2026-09-23, against a Snowflake-backed caslib on `verde`, via
`swat`'s binary protocol from Python running inside a compute session — not
from a `viya-api-probe` run, through the connected `sas-viya-mcp` tooling
instead. `conn.loadactionset("fedsql")` then
`conn.fedsql.execDirect(query="select 1 as X from connection to <caslib> (select 1)")`.
Environment: Python 3.12.12, `swat` 1.18.1. The CAS session was opened and
closed within the same run.

The action returned:

```
NOTE: Added action set 'fedsql'.
WARNING: Multi-node read is not allowed with the FedSQL execDirect action.
         The load will proceed with numReadNodes=1.
RESULT keys= ['Result Set']
SEVERITY= 1 STATUS= None
TYPE= swat.dataframe.SASDataFrame   MRO_has_DataFrame= True
SHAPE= (1, 1) COLUMNS= ['X']  VALUES= [{'X': 1}]
```

**What it establishes.** Four things, three of which were previously inferred
rather than measured — Finding 11.2 confirmed pass-through on `verde` via raw
`PROC CAS`, never via `swat`:

1. **`severity` is `1` on a fully successful call, with `status` `None`.** The
   `WARNING` line is what raises it. Any code that treats `severity == 0` as
   the success condition would misread a correct pass-through result as a
   failure. Confirmed as the multi-node warning specifically, not something
   general about `swat`'s severity reporting: a plain, unremarkable action
   (`conn.builtins.echo`) in the same session, and again in Finding 12.9's own
   probe, returned `severity = 0`.
2. The result member is keyed exactly `Result Set` — the string
   `docs/cas-python-connection.md` already documents, now observed on the
   `swat` path rather than assumed from the `PROC CAS` one.
3. That member's type is `swat.dataframe.SASDataFrame`, and `pandas.DataFrame`
   is in its MRO — so "already a `pandas.DataFrame`" in that same document is
   accurate as written.
4. `numReadNodes=1` is forced on the `swat` path too, not only the `PROC CAS`
   path Finding 11.2 measured, and CAS announces it as a `WARNING` rather than
   a `NOTE`.

**What it does not establish.** Nothing about the REST/HTTP transport, and
nothing about severity on a *failing* pass-through, which was not exercised.
"Success always means 1" is not claimed — only that success does **not**
reliably mean 0. The session close was confirmed by the client returning
`CLOSED ok`; it was not independently re-read afterwards to verify the
session is gone.

No deployment-identifying detail appears above: the caslib name, host, port,
session id and token are all omitted.

### Finding 12.8 — on `verde`, a bad credential on the CAS HTTP route is always a JSON `401`, never a `403` and never HTML

Observed 2026-09-23, read-only, from Python running inside a compute session
using `requests` — not from a `viya-api-probe` run. No credential was
supplied beyond the deliberately-invalid ones described; nothing was created
or mutated. All requests targeted the CAS HTTP base path's `cas/sessions`
resource unless stated otherwise:

| Request                                        | Status | Body type                        |
| ------------------------------------------------ | ------ | ---------------------------------- |
| `GET`, no `Authorization`                        | 401    | `application/vnd.sas.error+json`   |
| `GET`, invalid bearer                            | 401    | `application/vnd.sas.error+json`   |
| `PUT`, invalid bearer (the real session verb)    | 401    | `application/vnd.sas.error+json`   |
| `POST`                                           | 401    | JSON                                |
| `HEAD`                                           | 401    | —                                   |
| `OPTIONS`                                        | 200    | —                                   |
| `Authorization` value that is not `Bearer …`     | 400    | JSON                                |
| `cas/sessions` with the base path omitted        | 404    | empty                                |
| the same resource under the CAS proxy path       | 401    | SAS auth-layer v2 error shape        |
| the CAS pod's own HTTP port, plain `http`        | —      | `ConnectionError` (disconnected)     |

Every `401` carried `WWW-Authenticate: Bearer, Basic realm="controller"` and
`Server: envoy`.

**What it establishes.** No combination of missing, malformed or invalid
credential on `verde` produces a `403`, and none produces a non-JSON body.
When the route is reachable, it is CAS's own controller answering, and it
answers in JSON. So the `403`-plus-HTML failure the customer reported is not
explained by the URL shape, the HTTP verb, or the token being wrong or
expired — those all produce a JSON `401`. It is the front end refusing the
request before CAS sees it — the measurement behind
[`docs/cas-python-connection.md`](../cas-python-connection.md)'s "Binary vs.
REST/HTTP" section naming a REST connection's failure mode as an ingress
question, not a token question.

**What it does not establish.** `verde` fronts with Envoy; the customer's own
deployment fronts with nginx, a different ingress stack with different rules
and a different stock error page — this finding cannot reproduce that `403`
and does not attempt to diagnose it, only rules things out on `verde`. It
also came from inside the cluster: requests were hairpinned from a compute
pod out to the ingress and back, so an off-cluster client could meet a policy
(an allowlist, a WAF) that on-cluster traffic never sees. Whether the
customer's `403` is an unrouted path, an allowlist or a WAF rule is answerable
only from their own ingress controller logs — a platform-team question, not
one this project can settle.

No deployment-identifying detail appears above: base paths, tenant/org ids,
usernames and session ids are all omitted or generalised.

### Finding 12.9 — an open CAS connection outlives its access token; a live control confirms it

Observed 2026-09-23, on `verde`, via `swat`'s binary protocol from Python
running inside a compute session — not from a `viya-api-probe` run, through
the connected `sas-viya-mcp` tooling instead, and using the compute session's
own token (issued to client `sas.launcher`, not the `vscode` client this
extension borrows — see the caveat below). A connection was held open for
3865 seconds, crossing the token's own expiry, with an action issued roughly
every 160 seconds throughout:

| Moment                                                        | Result |
| ---------------------------------------------------------------| ------ |
| 93 s elapsed, after an idle gap                                 | `echo` `severity = 0` |
| every ~160 s from 1023 s to 3523 s                               | `echo` `severity = 0`, no gaps |
| 2 s before expiry                                                | `echo` `severity = 0` |
| 36 s, 96 s, 156 s past expiry                                    | `echo` `severity = 0` |
| 317 s past expiry, `table.caslibInfo`                            | `severity = 0`, real caslibs returned |
| 329 s past expiry, a **new** `swat.CAS()` with the same token    | **refused** — `OAuth authentication failed: Access denied.`, raised as `SWATError` |
| the held connection, the same instant                            | `echo` `severity = 0` |

**The last two rows are the finding.** The control is what makes it
conclusive: at one moment, the same token is refused for a new connection and
still working on the held one, so the token had genuinely expired and this
cannot be explained by clock skew or a mis-read `exp`. `table.caslibInfo` was
used alongside `echo` so the result is not merely a socket staying open — a
real, authorization-touching action returns real data after expiry.

**What it establishes.** CAS authenticates once, at connect; expiry does not
bite a connection already held. It refutes
[`docs/cas-python-connection.md`](../cas-python-connection.md)'s previous
"Reconnecting after a while" wording, which said an authentication error
after a session had been open for a while was "almost certainly" an expired
token — that page is corrected in the same commit as this finding.

**What it does not establish.** One connection, on `verde`, held for one hour
past one token's expiry — nothing about a much longer hold, a CAS server
restart, or revocation (a different mechanism from ageing out, not tested
here). And it used `sas.launcher`'s own token (measured at 3600 s, alongside
a 14-day `SAS_SERVICES_REFRESH_TOKEN`, same client), not the `vscode` client
this extension's own sessions use — so this finding is evidence about what
happens *after* expiry, not evidence for what this extension's own token
lifetime actually is. The corrected doc wording drops the "minutes, not
hours" number rather than inverting it, for the same reason.

Incidental: `CAS_SESSION_TIMEOUT` reads `60` (seconds) on `verde`, but does
not apply while a client holds the connection open — a session with no
client attached times out; an idle client holding one open, tested here at 93
seconds idle, does not.

No deployment-identifying detail appears above.

### Finding 12.10 — a Compute fileref can be rewritten in place, repeatedly, under a stable name

Observed 2026-09-23, on `verde`, against the Compute REST API directly via
`requests` (`SAS_COMPUTE_SERVICE_HOST`/`_PORT`, reachable in-cluster) — not
from a `viya-api-probe` run. A scratch compute session was created, a
fileref assigned under a fixed name, written, rewritten, read back, and the
session deleted (`204`); nothing was deassigned or deleted except the
scratch session itself.

| Step                                                        | Result |
| -------------------------------------------------------------| ------ |
| `POST` the session's `assign`, `{name, path: name}`           | `201`, with an `ETag` |
| the same `POST` again, same name                              | `400`, `errorCode` **5402**, `The fileref "…" already exists.` |
| `GET` the fileref's `self`                                     | `200` with an `ETag` |
| create-response `ETag` vs. that `self` `ETag`                  | identical |
| `PUT` `upload`, `Content-Type: text/plain`                     | `415` |
| `PUT` `upload`, `Content-Type: application/octet-stream`       | `201` |
| `PUT` `upload` again reusing the pre-write `ETag`               | `412` |
| `GET` `self` again                                              | `ETag` has changed |
| `PUT` `upload` with that fresh `ETag`                          | `201` |
| `GET` `content` (`Accept: application/octet-stream`)            | `200`, body is the second write, byte-exact |
| `GET` `content` before any write                                | `404`, `errorCode` **5409**, `Physical file … does not exist.` |
| `GET` `content` with `Accept: application/json`                 | `406` |
| `PUT` `upload` with no `If-Match`, on an existing fileref        | `428` |
| `GET` `self` after the failed re-create                        | `200`, name unchanged |

**What it establishes.**

1. **Resolve-and-rewrite under a stable name works, with nothing deassigned or
   deleted.** `assign` → on `400`/5402, skip the create → `self` `GET` for a
   fresh `ETag` → `upload` `PUT`. `src/compute/fileref.ts`'s never-deassign
   invariant — and the `404`-means-session-gone reading that rests on it — is
   untouched.
2. **The "already exists" case is distinguishable, not just retriable.**
   `errorCode` 5402 specifically, not a generic 4xx.
3. **`fileref.ts`'s own unmeasured shortcut is now measured, and it is safe on
   the create path but not the rewrite path.** Its doc comment notes that
   "nothing has measured whether a fileref's create-response `ETag` and its
   `self` `ETag` agree the same way." On a freshly-assigned fileref they do
   agree, so the extra `GET` right after a create is redundant. But the
   `ETag` rotates on every write, so that second `GET` is not optional for a
   rewrite — exactly the case a stable name introduces.
4. **Two header traps.** `text/plain` on the upload is a `415`;
   `Accept: application/json` on the content read is a `406`. Both links
   declare `application/octet-stream` and mean it; neither status names the
   header that caused it.
5. **Finding 36's `428` (no `If-Match`) holds for a rewrite, not only a first
   write.**

**What it does not establish.** This reproduced `fileref.ts`'s sequence by
hand against the server — it confirms the server supports the pattern, not
that this project's own client code takes it correctly. Concurrency (two
writers racing on one stable name, which `412` is precisely built to catch)
was not tested; nor was any context other than the one scratch session used
here.

No deployment-identifying detail appears above.

# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is fully complete and merged — 6a–6e all landed.** A SAS Content tree (My Favorites / My Folder / SAS Content / Recycle Bin) with open/save via a `sasContent:` `FileSystemProvider`, create/rename/move/delete, drag-and-drop, favourites, a recycle bin, and right-click Cut/Paste as a permanent move alternative ([ADR-0030](docs/adr/0030-delete-recycles-content-items.md), [ADR-0031](docs/adr/0031-content-folder-resource-uri.md), [ADR-0032](docs/adr/0032-content-cut-paste.md)). Final merge: 6e as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash `a74f756`. `npm run verify` green throughout (1580 unit; coverage 95.57/95.51/95.26/95.57). **The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — its only open item, the top-level-folder permanent-delete confirmation, closed as a documented, deferred known gap (a Viya deployment-level install-time configuration, not something this codebase or account permissions control) — see `phase-6.md`'s Runbook and `manual-test-pass.md`'s §15 for the full account. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule — a move that should have happened at the Phase 6→7/8 checkpoint itself but was missed then; caught and fixed at the Phase 8→9 checkpoint instead.

**Phase 7 (Libraries and data viewer) is fully complete — 7a–7d all merged 2026-09-11.** `src/data/` (library/table tree, ADR-0027), the React + ag-grid-community data viewer webview with sort/filter/CSV export (ADR-0028/ADR-0029), the table properties panel, and Python↔SAS-library data exchange via `SAS.sd2df`/`df2sd`/`submit` (7d, no upstream equivalent) are all live. Findings 7.1–7.20 and every phase-specific ADR are in [`docs/phases/phase-7.md`](docs/phases/phase-7.md), which has the full slice-by-slice account. Final merge: 7d as [PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green throughout (1574 unit tests; coverage 95.62%/95.54%/95.38%/95.62% lines/branches/functions/statements). **The Phase 7→8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — see the "Phase 7→8 housekeeping" section below for what it found and fixed. The full slice-by-slice narrative that used to live here has moved to [`docs/status-archive.md`](docs/status-archive.md), per this file's own archival rule.

**Phase 8 (CAS and SWAT) is fully complete — 8a–8c all merged 2026-09-14.** A read-only CAS tree (servers, global caslibs, tables, and — once loaded — columns, no compute session needed — [ADR-0033](docs/adr/0033-cas-adapter-shape.md)); `pythonOnViya.insertCasConnectionSnippet` delivers a fresh CAS token via the same never-logged fileref-upload path Python source itself uses, never via inline submitted code (Finding 8.6); and CAS tables open in the same paged, sortable, filterable data-viewer panel Phase 7 built, generalized behind a `TableSource` interface rather than forked or forced through `LibraryAdapter`'s own view machinery ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final merge: 8c as [PR #171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green throughout (1703 unit; coverage 95.92/95.46/95.75/95.92). **The Phase 8→9 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-14** — see the "Phase 8→9 housekeeping" section below for what it found and fixed. **Three post-merge fixes then landed as [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173), squash `c2478bb`, merged 2026-09-14** — a `dataTable`-relation redirect (Finding 8.14), a CAS filter's error message surfacing an opaque code instead of CAS's own actionable sentence (Finding 8.15), and a tree-icon-refresh fix that live re-confirmation found still did not work, deferred at the time as a known gap — see `phase-8.md`'s "Post-merge fixes, 2026-09-14" Runbook entry for the full account. **That icon gap is now closed (2026-09-15).** `onDidChangeTreeData` resolves a fired element by object identity, never by `TreeItem.id`, so PR #173's state-updated *copy* was discarded silently; `src/cas/casTree.ts` now fires the identical element and overlays the loaded state in `getTreeItem`. Live-confirmed by Sean against a `.vsix` built from the fix, manual-test item 8.28 ticked — see `phase-8.md`'s "Icon-flip gap: root cause found, 2026-09-15" Runbook entry. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule.

**Phase 9 (Notebooks) is fully complete — 9a–9d all merged or decided,
2026-09-14/15.** ipynb-native execution (no `ms-toolsai.jupyter` dependency)
against the notebook's own compute session
([ADR-0024](docs/adr/0024-notebooks-are-ipynb-native.md)/[ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)),
cell output rendered via VS Code's own built-in `notebook-renderers`
extension with `text/html` sanitized before it ever reaches that renderer
([ADR-0036](docs/adr/0036-notebook-html-output-is-sanitized.md)), and
Problems-panel diagnostics for a raised cell via this module's own
`DiagnosticCollection`. Final merges: 9a
[PR #172](https://github.com/Shai-Alit/sas-py-vscode/pull/172) squash
`6884e49`; 9b [PR #176](https://github.com/Shai-Alit/sas-py-vscode/pull/176)
squash `9eca850`; 9c [PR #177](https://github.com/Shai-Alit/sas-py-vscode/pull/177)
squash `fa7222f`, merged 2026-09-15 — 9c's own PR review found four
sanitizer bypasses, all fixed and folded in before push. **9d (export)
scoped 2026-09-15 and decided: dropped outright, no code written** — a
`.ipynb` this extension writes is already exportable/convertible by any
ipynb-aware tool with zero help from this extension, and VS Code core
already covers per-output copy/save natively, so there was nothing left to
build (full reasoning in `phase-9.md`'s 9d Runbook entry). `npm run verify`
green throughout (1753 unit tests; coverage 96.04/95.51/95.9/96.04);
`npm run test:integration` green (433 passing). **The Phase 9→10
between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-15** —
see the "Phase 9→10 housekeeping" section below for what it found. The full
slice-by-slice narrative that used to live here has moved to
[`docs/status-archive.md`](docs/status-archive.md), per this file's own
archival rule.

**Phase 10 (Viya environment awareness) is fully complete — 10a and 10b
both merged, 2026-09-15 and 2026-09-16.** Those two slices were the whole
phase. 10a (`docs/phases/phase-10.md`) adds a local/remote package diff to
the existing `Show environment` document (a "Local comparison" section,
PEP 503-normalised so a capitalisation difference alone is never a false
mismatch) and a new filterable `Python on Viya: Search environment`
`QuickPick`, additive to the existing document. Final PR
[#178](https://github.com/Shai-Alit/sas-py-vscode/pull/178), squash
`62cf217`; `npm run verify` green (1771 unit; coverage
96.09/95.57/95.98/96.09), `npm run test:integration` green (436 passing).
10b reflects the remote package set to Pylance via generated catch-all
stubs (`typing/<import-name>/__init__.pyi`) and a managed
`python.analysis.stubPath`, guarding against a stub shadowing an installed
local package, the workspace's own source, and — found only by a
2026-09-16 deep-dive pass after several review rounds — Pylance's own
bundled typeshed (**Finding 10.7**, closed by the new
`src/run/typeshedNames.ts`, a 554-name generated exclusion list). A
"Restart Language Server" remedy was added alongside the original "Reload
Window" one once a full extension-host reload proved too costly (~60–90s,
dropped Viya connection) for what a bare catch-all stub buys (**Findings
10.4/10.5**). Final PR [#182](https://github.com/Shai-Alit/sas-py-vscode/pull/182),
squash `2842722`. `npm run verify` green end to end (1,814 unit tests;
coverage 96.3/95.68/96.08/96.3 lines/branches/functions/statements; `src/run`
at 100% branch coverage; `check:secrets` 502 files), `npm run test:integration`
green (454 passing). Every pre-push adversarial self-review and both of the
developer's own independent passes are folded into the merged branch — the
last of them, 2026-09-16, returned no blocking findings. The full
manual-test board (10.1–10.14) is all green; **Finding 10.3** (a `babel`
diagnostic that a full window reload alone did not clear) stands recorded
but was set aside by the developer, the same day, as a likely mistake in
how that one attempt was run rather than a reproduced defect, once
**Finding 10.5**'s `requests` re-test succeeded under the same shape of
test with the new remedy — not investigated further, not blocking. The full
slice-by-slice narrative that used to live here has moved to
[`docs/status-archive.md`](docs/status-archive.md), per this file's own
archival rule. **The Phase 10→11 between-phase housekeeping
(`HOUSEKEEPING.md`) ran and closed 2026-09-16** — see the "Phase 10→11
housekeeping" section below for what it found.

**Phase 11 (Remaining parity gaps) is done — 11a–11e all merged, 2026-09-17
through 2026-09-21.** The interactive window (11a, F7), the CAS/SWAT SQL
passthrough helper (11b, F9), three pre-release bug fixes (11c, B1/B2/B3),
CAS table properties and CSV export (11d, F2/F3), and session startup via
profile `sasOptions`/`autoExec` (11e) all shipped, each with its own
pre-push adversarial review and manual-test pass — full account in
[`docs/phases/phase-11.md`](docs/phases/phase-11.md). AI-agent integration
and CSV-guard research were scoped into the phase the same day work wrapped,
then moved out again, 2026-09-22, into a new [Phase
12](docs/phases/phase-12.md), which now gates v1.0 in its place
([ADR-0037](docs/adr/0037-ai-agent-integration-approach.md)) — the previous
Phase 12 ("second execution backend", never started) renumbered to [Phase
13](docs/phases/phase-13.md) to make room. `npm run verify` green throughout
(1,856 unit tests; coverage 96.38/95.85/96.16/96.38), `npm run
test:integration` green (495 passing), `npm run check:docs` green. **Three
decided-to-build follow-ups remain open, none started** — a large-table CSV
-export confirmation for SAS library tables, a `CasProblem` for an oversized
CAS response, and surfacing autoExec-error text — each already decided
"build it" but with no slice to land in; folded into Phase 12 as a new
slice, **12f** (labeled 12e at the housekeeping checkpoint; renumbered
12f later the same day, once 12c was inserted ahead of it — see below),
rather than left open-ended (`docs/phases/phase-12.md`). **The Phase 11→12
between-phase
housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-22** — see the
"Phase 11→12 housekeeping" section below for what it found. The full
slice-by-slice narrative that used to live here has moved to
[`docs/status-archive.md`](docs/status-archive.md), per this file's own
archival rule.

**Phase 12 started 2026-09-22. 12a (Agent Skill) shipped the same day** —
`.claude/skills/python-on-viya/SKILL.md`, no production code, teaching an
agent this project's actual execution model (upload-plus-`infile=`
submission, `SYSCC` as the real success signal, the interpreter
banner/`>>>` prompts as inherent noise, namespace lifecycle, one-run-at-a-
time, library/CAS access, the read-only environment probe, and the command
surface). Docs-only per `CLAUDE.md`'s adversarial-review section, so no
mandatory pre-PR pass — but Sean asked for a manual review anyway, since the
skill's content is something an agent acts on. That review found and fixed
three things: a real distribution gap (the skill has no path to an end user
— `.claude/` is excluded from the packaged `.vsix` — closed by adding
[`docs/agent-skill.md`](docs/agent-skill.md), wired into the site nav and
cross-linked from `getting-started.md`/`running-python.md`); a `SYSCC`/
`sessionConditionCode` conflation; and an overstated credential-leak claim
that surfaced a contradiction between ADR-0014 and `docs/data-access.md`.
**That contradiction was settled the same day by a live probe against
`verde`** — [Finding 12.1](docs/phases/phase-12.md) — confirming ADR-0014
(the outer Python cell is never echoed) and refuting `data-access.md`'s
"`SAS.submit()` masks a `password=`" claim: a `LIBNAME` statement's password
came back in the raw log in full plaintext, unmasked, when the statement
failed to parse. `docs/data-access.md` and `docs/cas-python-connection.md`
are corrected accordingly. `prettier --check`, `check:secrets`, and
`check:docs` (reference check, samples, self-links, VitePress build) all
clean.

**12b (Option C spike) ran 2026-09-22 — viable, go.** A standalone loopback
HTTP MCP server (never touching `src/`) confirmed both questions the
2026-09-21 research memo flagged as genuinely undocumented: a real,
separate Claude Code CLI session connects over loopback HTTP with an
out-of-band bearer token and completes an actual tool call; and a killed/
restarted server (standing in for a VS Code window reload) is transparent
to the CLI when port and token are both stable, with `headersHelper` —
confirmed from Claude Code's own live docs, not assumed — as the
documented, right-shaped mechanism for the case where the token isn't (one
real prerequisite found along the way: Claude Code requires its own
one-time interactive per-workspace trust acceptance before running a
`headersHelper`, layered on top of and separate from VS Code's own
workspace trust/ADR-0002). Three secondary questions from the memo (Agent
Host forwarding of extension-registered servers; whether the in-VS-Code
Claude harness sees them; `resolveMcpServerDefinition` re-invocation on
token expiry) remain undocumented after a fresh check today — unchanged
from the memo, out of this spike's scope. Full method and results in
`docs/phases/phase-12.md`'s Runbook. Per ADR-0037's own consequences
section, the actual build is a separate, not-yet-scoped slice, not started
here, and still carries the ADR's named requirement for its own security
review before any code merges.

**12c (scope the actual Option C build) added and scoped 2026-09-22, the
same day, once 12b returned viable/go** — inserted ahead of the phase's
other unstarted slices, which renumbered old 12c→12d (Python-startup-snippet
spike) and old 12d→12e (CSV-guard research). 12c's own deliverable — a
design and punch list for a not-yet-numbered future build slice, no `src/`
code — settles the tool surface (read-only `LibraryAdapter`/`CasAdapter`
operations only; `ExecutionBackend` named as a separate, later,
separately-reviewed decision), the token/lifecycle design (a
`headersHelper`-shaped local secret independent of the Viya token,
replacing the static-header design 12b found cannot self-heal on
rotation), and what ADR-0037's own named pre-code security review must
cover. **The audience-boundary question — external CLI agents only for
v1, vs. also VS Code's own in-editor agent discovery — is fully settled,
not just recommended.** Sean asked how to decide it with nothing
documented; the answer was to probe VS Code's own behaviour directly
rather than keep reasoning from absent docs, the same posture this
project already takes toward Viya. A live Extension Development Host
probe the same day found VS Code's core does automatically query an
extension-registered `contributes.mcpServerDefinitionProviders` provider
— but a VS Code core team member and a still-open `microsoft/vscode`
issue ([#265912](https://github.com/microsoft/vscode/issues/265912))
confirm that registration is currently invisible in every standard MCP
management surface (no way for a user to see, trust, start, stop, or
remove it) — a real, current, tracked product gap, not an unproven
integration. Decision: build against the external-CLI path only for v1;
revisit in-editor discovery once that VS Code issue closes. Full method
and findings in `docs/phases/phase-12.md`'s "12c scoped" and "12c
audience boundary settled" Runbook entries.

**Three more slices — 12g, 12h and 12i — were added 2026-09-22**, from two
pieces of work that ran entirely outside this repository the same day
(labeled 12f/12g/12h when added; renumbered 12g/12h/12i the same day once
12c's own insertion, above, shifted every later slice one letter — see
"Letter collision reconciled" below). Hand-running SAS's own VS Code
extension in a `.sasnb` notebook against a Viya 4 deployment produced
Findings 12.2 and 12.3: `PROC PYTHON` emits a
`NOTE: Resuming Python state from previous PROC PYTHON invocation.` when
interpreter state survives between steps in one session (**12g** — does that
`NOTE` reach *our* transcript, and is it misleading on Run File or flatly
wrong after Reset Python State? no Viya probe needed, just run the extension
and read the output channel), and SAS's extension opens a named
`ods html5(id=…)` destination with images inlined as base64 `data:` URIs
before every run, which is how `SAS.show(plt)` renders a figure in a cell
(**12h** — a spike, Sean's call: settle the cheap blocking questions, leave
any build to a separate, not-yet-scoped slice, the same boundary 12b drew
for Option C). Two of 12h's four questions are already answered from this
repository's own source, and favourably: the notebook sanitizer does **not**
strip `data:` image URIs — it accepts inline PNG/JPEG/GIF/WebP and rejects
SVG deliberately — so no [ADR-0036](docs/adr/0036-notebook-html-output-is-sanitized.md)
relaxation is needed for the PNG path, and
[ADR-0019](docs/adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)'s
rich-output capture already diffs the session's files and whitelists
`.png`/`.html`, so a figure written to a file already reaches users today.
Separately, a dependency-licence inventory produced for an internal
open-source-contribution request found that twelve MIT packages ship inside
`dist/webview/dataViewer.js` despite `package.json` declaring no
`dependencies` at all, and that the root `NOTICE` attributes none of them
(**12i** — append a "Bundled third-party components" section; `NOTICE`
already ships, so packaging does not change). 12d–12i are all unstarted —
see `docs/phases/phase-12.md` for the full account.

**Letter collision reconciled, 2026-09-22.** 12c's own insertion (above)
and PR #207's 12f/12g/12h were scoped in two sessions working this phase
concurrently from separate clones, this project's own established
parallel-phases pattern — both independently reached for the next free
letter after the same five-slice base, so 12c's branch and #207 each used
`12f` for a different slice. Caught when 12c's branch rebased onto #207
after it merged; resolved by a uniform shift preserving both sides' own
relative order (12c's insertion point right after 12b stands; everything
from the old 12c onward, #207's newly merged trio included, moves one
letter later) rather than re-litigating which slice belongs where. Full
account in `docs/phases/phase-12.md`'s own "Letter collision reconciled"
Runbook entry.

## Phase 5→6 housekeeping — done 2026-09-09

Full write-up in `docs/status-archive.md`; the outcomes:

- **All seven `HOUSEKEEPING.md` checklist items clean or reconciled.** ADRs
  correct (ADR-0023's title/index row now note the 2026-09-04
  `--azure-credential` amendment); `phase-5.md` punch list fully ticked;
  `RUNBOOK.md` / `PRODUCTION_PLAN.md` current (coverage figures match
  `.c8rc.json` 94/94/93/95); no scratch files outstanding; **0 open Dependabot
  alerts** and `scripts/advisory-allowlist.json` empty.
- **Finding 74 closed** by a live probe → **Finding 93** (`phase-5.md`): no
  `PROC PYTHON` option suppresses the interpreter banner or `>>>` prompt
  markers. Decision (Sean): accept and document — `manual-test-pass.md` §6 and
  the user docs reworded to treat them as inherent `PROC PYTHON` output.
- **Full manual test pass ran 2026-09-09** (Sean) against `verde` (SSO) /
  `Innov` (SAS corporate creds) with the published `.vsix` — the first full
  pass since 2026-08-27. Everything passed **except the 5d-i user-provided-CA
  row**, which needs a deployment whose chain the OS distrusts (none available;
  stays deferred). It surfaced one bug:
  - **Fileref collision after reopening VS Code** on a folder with a long-lived
    session — `listFilerefNames` read only the first page of the fileref
    collection, under-seeding Finding 72's counter. **Fixed** (paginate the
    listing; **Finding 94**) in [PR #135](https://github.com/Shai-Alit/sas-py-vscode/pull/135),
    squashed as `9cb7de9`.
- **Also merged:** stale-comment sweep in `src/run`
  ([PR #133](https://github.com/Shai-Alit/sas-py-vscode/pull/133)); the
  housekeeping docs ([PR #132](https://github.com/Shai-Alit/sas-py-vscode/pull/132),
  [PR #134](https://github.com/Shai-Alit/sas-py-vscode/pull/134)); and
  `CLAUDE.md` hardened so the adversarial review always happens **before** a PR
  is opened.

## Phase 7→8 housekeeping — done 2026-09-11

The outcomes:

- **ADRs correct.** [0027](docs/adr/0027-library-adapter-shape.md), [0028](docs/adr/0028-data-viewer-is-react-and-ag-grid.md), [0029](docs/adr/0029-sort-view-lifecycle.md), and [0003](docs/adr/0003-extension-host-target.md)'s 2026-09-11 amendment all read as correct and internally consistent with what shipped. Nothing to fix.
- **One stale punch-list checkbox fixed**: `phase-7.md`'s 7c-iii header had never been flipped to ☑ despite every sub-item under it being done and PR #161 merged — a doc-hygiene slip, corrected.
- **`PRODUCTION_PLAN.md` §3.1's parity table gained a row for 7d** (Python↔library data exchange via `SAS.sd2df`/`df2sd`/`submit`) — a no-upstream-equivalent capability, like the existing CAS/SWAT row, that had no row of its own.
- **`STATUS.md`'s own Phase 7 entry trimmed** per this checkpoint's own rule (both the body narrative and the phase-index row) — the full narrative moved to `docs/status-archive.md`.
- **No scratch/pending files** to reconcile — none existed.
- **Manual test pass**: §10–§13 all fully passed. Two rows in the old §17 (the `PROC PYTHON` SQL-pass-through example; duplicate-drop de-duplication) had been left unrun with no prior explanation. A CSV-export (7c-iii) section was missing from the manual-test tracking doc entirely despite the feature being merged and live-facing; added (items 7.44–7.47) to track it. **The manual-test doc itself was also restructured this session, per Sean's own request** — `docs/dev/manual-test-pass.md` is now a stub; the real content lives at [`docs/dev/manual-tests/`](docs/dev/manual-tests/setup.md), one file per phase plus a `setup.md` and a `misc.md` for phase-agnostic checks, every item numbered (`S.1`, `1.1`, `6.4`, `M.2`, …) instead of a bare bullet. **Sean then ran the new items live, 2026-09-11**: CSV export (7.44–7.47) and duplicate-drop de-duplication (7.43) all pass — see `phase-7.md`'s 7c-iii and 7d Runbook entries. The one remaining open row is the `PROC PYTHON` SQL-pass-through example (`docs/dev/manual-tests/phase-7.md` item 7.39), still unrun.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live); `scripts/advisory-allowlist.json`'s `allowed` list is empty and consistent.
- **Phase 8 (next) scoping has drift from Phase 6/7 learnings**, found and partly fixed this session: `phase-8.md`'s stale "should `src/wire/` promotion happen here" question is already resolved (ADR-0025, shipped in 6a) — corrected in place. Findings 87–92 in `phase-8.md`, carried under the old global numbering scheme, are renumbered `8.1`–`8.6` now that Phase 8 is being picked up, per `CLAUDE.md`'s numbering rule. Not fixed, flagged for whoever writes 8b: no connection is drawn yet between Finding 7.3/ADR-0027's "refuse rather than queue" busy-session precedent and an analogous CAS/SWAT concurrency question.
- **Innov cross-check attempted, still open.** Phase 7's Findings 7.10–7.20 were only ever probed against `verde`; a live retry this session found `innovationlab.sas.com` fails DNS resolution outright ("Non-existent domain") — a different symptom than the VPN-timeout signature earlier Phase 7 sessions hit. `verde` itself resolved and responded normally over the same network at the same time. Left open, Sean's call, same as every prior "not probed against Innov" note in `phase-7.md` — not blocking Phase 8.

## Phase 8→9 housekeeping — done 2026-09-14

The outcomes:

- **ADRs correct.** [0033](docs/adr/0033-cas-adapter-shape.md) (`CasAdapter` shape) and [0034](docs/adr/0034-table-source-abstraction.md) (`TableSource` abstraction) both read as correct and internally consistent with what shipped. Nothing to fix.
- **Punch list: clean.** 8b and 8c are fully ticked. 8a's three open items (a second-cadence probe blocked on a stale `innov` credential; the no-`sessionId` reading unconfirmed for a session-scoped caslib, none existing on `verde`; the `sortBy=name` fix unverified for 3 of 4 collections) each already carry a stated reason — left open as documented gaps, not fixed this session.
- **`RUNBOOK.md` / `PRODUCTION_PLAN.md` current.** §3.1's CAS/SWAT parity row reads correctly as-is; `.c8rc.json`'s thresholds (95.8/95.8/95.6/95.4) match the last reported coverage (95.92/95.46/95.75/95.92, cleared with no ratchet raise needed). Nothing to fix.
- **`STATUS.md` trimmed — two phases, not one.** Phase 8's own entry (this checkpoint) was trimmed to a short paragraph and phase-index row, full narrative moved to `docs/status-archive.md`, per the standing rule. **Phase 6's entry was found not to have been trimmed at the Phase 6→7/8 checkpoint** — that checkpoint's own outcomes note only mentions trimming Phase 7's entry, and Phase 6's full 6a–6e narrative was still sitting in both the body text and the phase-index table, with no copy in `status-archive.md`. Fixed at this checkpoint: both phases' full narratives are now archived and both entries read as short summaries.
- **No scratch/pending files** existed to reconcile.
- **Manual test pass: 8a and 8b fully run and passed** (`docs/dev/manual-tests/phase-8.md`) — all ten 8a items pass; all ten 8b items pass or are explicitly noted not independently reachable (§8.13, §8.17). **8c (CAS tables in the data viewer) had no tracking section at all**, despite being merged and live-facing — the same gap the Phase 7→8 checkpoint found and fixed for 7c-iii's CSV export. Added items 8.21–8.27 to track opening a CAS table, JIT-load-on-open, sort/filter, panel reveal/dedup, cross-deployment panel isolation (ADR-0034), dispose, and theme legibility — **not yet run**, left for Sean to run and check off.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live via `gh api`); `scripts/advisory-allowlist.json`'s `allowed` list is empty and consistent, nothing near expiry.
- **Phase 9/10 scoping: no drift found.** Grepped both `phase-9.md` and `phase-10.md` for any reference to Phase 8/CAS/`TableSource` work that might now be stale or resolved differently than assumed; no hits in either file. Not edited — Phase 9 is being worked concurrently by another session.

## Phase 9→10 housekeeping — done 2026-09-15

The outcomes:

- **ADRs correct.** [0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)
  (notebook gets its own compute session) and
  [0036](docs/adr/0036-notebook-html-output-is-sanitized.md) (HTML output
  sanitized) both read as correct and internally consistent with what
  shipped. **No amendment needed for [0024](docs/adr/0024-notebooks-are-ipynb-native.md)**
  either — 9d's drop is the payoff that ADR already named for going
  ipynb-native, not a new decision.
- **Punch list: clean.** 9a/9b/9c were already fully ticked. 9d — the one
  item still open — was scoped this session and decided: dropped outright,
  with the reasoning recorded in `phase-9.md`'s own Runbook entry (VS Code
  core already covers per-output copy/save via the bundled `ipynb`
  extension; whole-notebook export is `ms-toolsai.jupyter`'s own feature,
  backed by a local `nbconvert` dependency this project has never taken on
  and declined again here for the same reason 9a declined it for execution).
  Phase 9's punch list is now fully ticked, 9a through 9d.
- **`STATUS.md` trimmed.** Phase 9's own entry (this checkpoint) was cut
  down to a short paragraph and phase-index row; the full 9a–9d narrative,
  plus 9d's own resolution, moved to `docs/status-archive.md`.
- **One doc-consistency gap found and fixed: two Phase 9c gaps that
  `phase-9.md` said were "carried to `phase-11.md`" had never actually
  landed there.** A rejected `appendOutput` mid-stream (notebook closed
  mid-run) skipping `execution.end` (Finding 10), and a stale Problems entry
  for a notebook cell outliving a sign-out (the half of Finding 2 that
  wasn't fixed) — both real, both correctly described in `phase-9.md`, but
  the actual carry-forward into `phase-11.md`'s "Also carried here" list
  never happened. Added this session, dated to this checkpoint rather than
  backdated, with a note that they should have landed with 9c's own merge.
- **No scratch/pending files** existed to reconcile.
- **Manual test pass: fully complete.** Every Phase 9 manual-test item
  (§9.1–§9.14, `docs/dev/manual-tests/phase-9.md`) is checked — none left
  unrun. 9d needs no manual test; nothing shipped to test.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live
  via `gh api`); `scripts/advisory-allowlist.json`'s `allowed` list is empty
  and consistent, nothing near expiry.
- **Phase 10 scoping: no drift found.** Grepped `phase-10.md` for references
  to Phase 9/notebook work that might now be stale; the only hits are
  general precedent-citing mentions of Phase 9's own scoping approach (the
  `ms-toolsai.jupyter`-shaped dependency question, the "no probe needed"
  reasoning), nothing that names an ADR-0035/ADR-0036/`BackendCache` detail
  that changed since. **Not edited** — Phase 10 is being worked concurrently
  by another session, per this project's own separate-clone convention.

## Documentation catch-up — done 2026-09-15

A completeness pass, run during Phase 10 at the developer's request, found
that Phase 8's CAS tree and Phase 9's notebooks had shipped with **no**
user-facing documentation (Phase 8 had one page for the Python-side CAS
connection, but it was never wired into `docs/README.md` or the VitePress
nav and so was unreachable; Phase 9 had nothing at all), and that Phase 6's
Cut/Paste move was undocumented too. Fixed in the same session: new
[`docs/browsing-cas.md`](docs/browsing-cas.md) and
[`docs/notebooks.md`](docs/notebooks.md), both registered in
`docs/README.md` and `.vitepress/config.mjs`'s `nav`/`sidebar`; a Cut/Paste
section added to `docs/browsing-sas-content.md`; cross-links added from
`getting-started.md`, `faq.md`, `troubleshooting.md`, `running-python.md`,
`browsing-sas-libraries.md`, and `cas-python-connection.md`. `npm run
check:docs` (reference tables, samples, self-link check, VitePress build)
and `check:secrets` both green throughout. Full accounts are each phase's own
Runbook — see `phase-6.md`'s, `phase-8.md`'s, and `phase-9.md`'s own
"Documentation catch-up, 2026-09-15" entries.

## Phase 10→11 housekeeping — done 2026-09-16

The outcomes:

- **ADRs correct — none needed.** Phase 10 introduced no new ADR; the two
  places its own Runbook said an existing ADR could have been implicated
  both check out as-is: `localPackages.ts`/`localPythonEnvironment.ts` read
  a local interpreter's `site-packages` via `vscode.workspace.fs`, not
  `node:fs`, so [ADR-0003](docs/adr/0003-extension-host-target.md)'s Node
  built-in allow-list needed no amendment (confirmed: `eslint.config.mjs`'s
  `no-restricted-imports` allow-list is unchanged from before this phase);
  and the parity table decision (below) confirms
  [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) §3.1 already carried a row for
  this phase.
- **Punch list: clean.** 10a and 10b are both fully ticked in
  `phase-10.md`'s Runbook, including the 10b spike item. Nothing open.
- **`RUNBOOK.md` / `PRODUCTION_PLAN.md` current, one stale note fixed.**
  §3.1's parity table already had a row for this phase ("Viya Python
  environment awareness | Phase 3e, extended in Phase 10") from the
  original scoping pass — nothing to add. §4's coverage note was stale: it
  still read "as of 2026-09-10 that's lines 94 / statements 94 / functions
  94 / branches 95", three ratchets out of date against the actual
  `.c8rc.json` (95.8/95.8/95.6/95.4, raised at the Phase 8→9 checkpoint,
  2026-09-14) — corrected. Current coverage (96.3/95.68/96.08/96.3
  lines/branches/functions/statements) clears every threshold with margin;
  no ratchet raise needed this checkpoint, same call the Phase 8→9
  checkpoint made.
- **No scratch/pending files** existed to reconcile.
- **Manual test pass: fully complete.** All fourteen Phase 10 items
  (10.1–10.14, `docs/dev/manual-tests/phase-10.md`) are checked and passed.
  Finding 10.3's open `babel` result (§10.8's first attempt) is recorded,
  not silently dropped, and was already set aside by the developer as a
  likely mistaken run rather than a reproduced defect once Finding 10.5's
  `requests` re-test succeeded under the same shape of test — nothing left
  to schedule here.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live
  via `gh api`); `scripts/advisory-allowlist.json`'s `allowed` list is empty
  and consistent, nothing near expiry. One routine, unrelated open PR
  (dependabot's dev-tooling group bump, #175) sits open — not a security
  advisory, no action needed from this checkpoint.
- **Phase 11 scoping: no drift found.** `phase-11.md`'s two Phase 10-sourced
  carried items both already read correctly: the `pythonOnViya.*` stub
  opt-out setting is still an open candidate, and the `workspaceFolderValue`
  item is correctly recorded as closed on the 10b branch itself
  (`c81f9d5`), kept as a one-paragraph record rather than deleted, matching
  how the Phase 8 CAS icon-flip item was handled. `phase-12.md` has no
  reference to Phase 10 at all — nothing to reconcile there.
- **`STATUS.md` trimmed.** Phase 10's own entry (this checkpoint) was cut
  down to a short paragraph and phase-index row; the full 10a/10b
  narrative — spike, both PRs, every review round, the manual-test session,
  and the 2026-09-16 deep-dive pass — moved to `docs/status-archive.md`.

## Phase 11→12 housekeeping — done 2026-09-22

The outcomes:

- **ADRs correct.** [ADR-0037](docs/adr/0037-ai-agent-integration-approach.md)
  and `phase-11.md`'s own F7 write-up (used in place of a standalone ADR, a
  deliberate call already recorded in its 11a Runbook entry) both read as
  correct and internally consistent with what shipped. Nothing to fix.
- **Punch list: 11a–11e complete; three follow-ups scheduled, not fixed
  this session.** Large-table CSV confirmation for SAS library tables, a
  `CasProblem` for an oversized CAS response, and surfacing autoExec-error
  text are each decided ("build it") but unstarted. **First recorded here as
  "carried forward as documented open items," on the model of Phase 8a's
  own three open items — corrected within the same session**: Phase 8a's
  items are each blocked on something external (a stale credential, a
  not-yet-existing environment); these three are not blocked on anything,
  just unscheduled, so "carried forward" understated the gap. Fixed by
  giving them a slice: **12f** (labeled 12e at this checkpoint; renumbered
  12f later the same day, once 12c was inserted ahead of it), in
  `docs/phases/phase-12.md`. See `phase-11.md`'s own "Phase 11→12
  housekeeping" Runbook entry, which also corrects that file's earlier
  "once those land, Phase 11 is done" line.
- **`RUNBOOK.md` / `PRODUCTION_PLAN.md`: one stale claim fixed.** §3.1's
  parity table's "Localisation" row still read `Phase 11 (bundles)`,
  contradicting `phase-11.md`'s own 2026-09-22 decision that non-English
  bundles are not happening at all, ever — corrected. Coverage thresholds
  (`.c8rc.json`, 95.8/95.8/95.6/95.4) are cleared with margin by the last
  reported run (96.38/95.85/96.16/96.38, 11e); no ratchet raise needed.
- **`STATUS.md` trimmed.** Phase 11's own entry (this checkpoint) was cut
  down to a short paragraph and phase-index row; the full 11a–11e
  narrative — every review round and both manual-test sessions — moved to
  `docs/status-archive.md`.
- **No scratch/pending files** existed to reconcile.
- **Manual test pass: complete except one already-documented gap.**
  11.1–11.9 and 11.11–11.28 (`docs/dev/manual-tests/phase-11.md`) all pass;
  11.10 (B1 on the SAS Libraries tree, for a failure that isn't the session
  being gone) stays unchecked with its own recorded reason — nothing new to
  run.
- **Dependency advisories: clean.** 0 open Dependabot alerts (checked live
  via `gh api`); `scripts/advisory-allowlist.json`'s `allowed` list is empty
  and consistent, nothing near expiry. One routine, unrelated open PR
  (dependabot's dev-tooling group bump, #200) sits open — not a security
  advisory, no action needed from this checkpoint.
- **Phase 12 scoping: no drift found.** `phase-12.md`'s four slices at this
  point — 12a, 12b, and what a later 2026-09-22 insertion of 12c renumbered
  to 12d and 12e — read consistently with ADR-0037 and with `phase-11.md`'s
  own account of the AI-agent-integration move; every renumbering
  cross-reference (`docs/adr/0007-connection-profile-storage.md`,
  `phase-3.md`, `PRODUCTION_PLAN.md` §8, `docs/dev/manual-tests/`) already
  points at Phase 13, none stale.

## Open items carried forward

- **Open VSX namespace claim — closed, confirmed 2026-09-22.** The `shai-alit`
  namespace request was filed and has been granted: `GET
  https://open-vsx.org/api/shai-alit` returns `"verified": true`. The ⚠️
  unverified-publisher warning no longer applies. `PRODUCTION_PLAN.md` §8's
  wording is now amended to record the grant, alongside the Phase 12/13
  renumbering (below).
- **5d-i user-provided-CA live test** — the one unrun `manual-test-pass.md` row
  (§3). Needs a deployment whose certificate chain the OS does not already
  trust. Run it when such an environment exists.
- **Phase 11 (parity gaps): Accounts-menu legibility — closed as a documented
  known limitation, 2026-09-22.** Two profiles for different deployments can
  show an identical `<name> (SAS Viya)` row with nothing distinguishing which
  profile signed in as which; not worth a code fix before 1.0 (Sean's call).
  Documented in `docs/signing-in.md`'s "More than one deployment at once"
  section; full record, including a correction to the original 2026-09-09
  observation once the source confirmed this extension only ever registers
  one provider label, in `docs/phases/phase-11.md`'s "Accounts-menu
  legibility" entry. Related: [#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42).
  §8's 1.0 wording (`PRODUCTION_PLAN.md`) is now updated to record this and
  every other named gap as closed.
- **Hosted docs site** — deliberately **not planned**, and explicitly *not* a
  1.0 gate (`PRODUCTION_PLAN.md` §8, "Definition of done — 1.0"). The VitePress
  build runs as a CI link-check gate; nothing deploys the output. A standalone
  task if ever revisited, not a phase slice.

Three Phase 11 follow-ups (large-table CSV-export confirmation for SAS
library tables, a `CasProblem` for an oversized CAS response, surfacing
autoExec-error text) are **not** listed here: each already carried a
same-day "build it" decision, so — unlike the items above — nothing about
them was actually open except *when*. Fixed by scheduling them rather than
leaving them here: they're **Phase 12 slice 12f** (labeled 12e at the
housekeeping checkpoint; renumbered 12f later the same day, once 12c was
inserted ahead of it) (`docs/phases/phase-12.md`), added at the Phase
11→12 housekeeping checkpoint, 2026-09-22.

- **F11 — Snippets for common Viya patterns, general: genuinely unscoped,
  found 2026-09-22 (PR #204 review).** Named in Phase 11's own original
  one-liner alongside session startup, result panel styling, and
  localisation, but — unlike those three — never got a closure or
  carry-forward decision. What shipped: the narrow F9 CAS/SWAT SQL
  passthrough snippet (11b). The broader library-of-snippets idea was never
  sized, scoped, or decided against; it has no owner now that Phase 11 is
  closed. Not decided here — flagged, not scoped, same treatment as F1/F6.
  See `phase-11.md`'s "New feature candidates" list.

No new GitHub issues are being filed while the project is pre-release /
invite-only — tracked work lives in the phase files and as `fix/` PRs. Revisit
issue tracking once past "preview". That revisit is now a named 1.0 gate — see
`PRODUCTION_PLAN.md` §8, "Definition of done — 1.0".

## Finding-numbering scheme changed 2026-09-09

Probe findings are now numbered per-phase (`N.x`), not one continuing global
sequence — see `CLAUDE.md`'s "Don't guess about Viya — probe it" section for
the full rationale (this project now works phases in parallel from separate
clones, and a continuing global counter can't be claimed safely by two
sessions at once) and the rules for applying it. **Applies from Phase 6
onward:** Phase 6's 6b-and-later findings are `6.1`, `6.2`, …; Phase 7's were
renumbered `7.1`–`7.7` (previously the global 83–86, 95, 96, 102). The old
flat sequence ran through **Finding 101** — findings written under it
(including Phase 6's 78–82 and 97–101) keep their global numbers. Any
already-recorded phase 8–10 findings from their scoping sessions keep their
global numbers until that phase is picked up, then move to `N.x` — not
preemptively.

## History

`docs/status-archive.md` holds the slice-by-slice narrative for Phase 3f
through the `v0.1.1` release and the Phase 5→6 housekeeping — the reasoning
captured in passing, moved out of this file 2026-09-09. Phase 7's own
narrative was appended 2026-09-11 at the Phase 7→8 housekeeping checkpoint.
Phase 6's and Phase 8's own narratives were both appended 2026-09-14 at the
Phase 8→9 housekeeping checkpoint — Phase 6's should have moved at the
Phase 6→7/8 checkpoint but was missed then. Phase 9's own narrative,
9d's resolution included, was appended 2026-09-15 at the Phase 9→10
housekeeping checkpoint. Phase 10's own narrative — 10a, the 10b spike, both
PRs and every review round, the manual-test session, and the 2026-09-16
deep-dive pass — was appended 2026-09-16 at the Phase 10→11 housekeeping
checkpoint. Phase 11's own narrative — 11a–11e, every review round, and both
manual-test sessions — was appended 2026-09-22 at the Phase 11→12
housekeeping checkpoint. Per-phase detail
(plan, punch list, probe findings) is bundled in each
`docs/phases/phase-N.md`.

> Update this file when a slice lands, not just at phase boundaries — in the
> same PR that does the work. Keep it lean: it is the only file every session
> should need to open to know where to start. Put slice-by-slice detail in the
> phase file, and move a completed phase's narrative into `status-archive.md`
> at the between-phase boundary rather than letting this file grow without
> bound.

## Phase index

| Phase | Status | File |
|---|---|---|
| 0 — Repository foundation | ✅ done | `docs/phases/phase-0.md` |
| 1 — Auth & connection profiles | ✅ done | `docs/phases/phase-1.md` |
| 2a — Compute core & VS Code shell | ✅ done | `docs/phases/phase-2a.md` |
| 2b — Backend seam, dialects, job log & the pump (covers 2b and 2c) | ✅ done | `docs/phases/phase-2b.md` |
| 3 — Run Python (vertical slice) | ✅ **done, 3a–3f.** Finding 74 (interpreter banner / `>>>`) fully closed 2026-09-09 by Finding 93 — accepted and documented. | `docs/phases/phase-3.md` |
| 4 — Diagnostics | ✅ **done, 4a–4d.** Phase 4→5 housekeeping ran 2026-09-02 (`baacf3c`). | `docs/phases/phase-4.md` |
| 5 — Hardening & first release | ✅ **done — all slices merged; `v0.1.1` is the first published release.** Phase 5→6 housekeeping ran 2026-09-09 (see above). | `docs/phases/phase-5.md` |
| 6 — SAS Content explorer | ✅ **done — 6a–6e all merged.** SAS Content tree, open/save `FileSystemProvider`, create/rename/move/delete, drag-and-drop, favourites, recycle bin, Cut/Paste. Final PR [#162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash `a74f756`. `npm run verify` green (1580 unit; coverage 95.57/95.51/95.26/95.57). Phase 6→7/8 housekeeping ran and closed 2026-09-11 (see above). | `docs/phases/phase-6.md` |
| 7 — Libraries and data viewer | ✅ **done — 7a–7d all merged 2026-09-11** (library/table tree, React+ag-grid data viewer with sort/filter/CSV export, table properties panel, Python↔library data exchange via `SAS.sd2df`/`df2sd`/`submit`). Final PR [#163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green (1574 unit; coverage 95.62/95.54/95.38/95.62). Phase 7→8 housekeeping ran and closed 2026-09-11 (see above). | `docs/phases/phase-7.md` |
| 8 — CAS and SWAT | ✅ **done — 8a–8c all merged.** CAS browsing tree ([ADR-0033](docs/adr/0033-cas-adapter-shape.md)), authenticated CAS session helper, CAS tables in the data viewer via a `TableSource` abstraction ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final PR [#171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green (1703 unit; coverage 95.92/95.46/95.75/95.92). Phase 8→9 housekeeping ran and closed 2026-09-14 (see above). Three post-merge fixes landed as [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173), squash `c2478bb`, merged 2026-09-14; its one deferred gap (tree icon refresh) was root-caused and fixed 2026-09-15 — `onDidChangeTreeData` matches a fired element by object identity, not `TreeItem.id` — and live-confirmed, so nothing from Phase 8 is carried forward. | `docs/phases/phase-8.md` |
| 9 — Notebooks | ✅ **done — 9a–9d all merged or decided, 2026-09-14/15.** ipynb-native execution, no `ms-toolsai.jupyter` dependency, against the notebook's own compute session ([ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)); cell output via VS Code's own built-in `notebook-renderers` extension, `text/html` sanitized first ([ADR-0036](docs/adr/0036-notebook-html-output-is-sanitized.md)); Problems-panel diagnostics for a raised cell. 9d (export) scoped and dropped outright — ipynb's own portability and VS Code core's native per-output commands already cover it. Final PRs [#172](https://github.com/Shai-Alit/sas-py-vscode/pull/172)/[#176](https://github.com/Shai-Alit/sas-py-vscode/pull/176)/[#177](https://github.com/Shai-Alit/sas-py-vscode/pull/177), squash `6884e49`/`9eca850`/`fa7222f`. `npm run verify` green (1753 unit, 96.04/95.51/95.9/96.04); `npm run test:integration` green (433 passing). Phase 9→10 housekeeping ran and closed 2026-09-15 (see above). | `docs/phases/phase-9.md` |
| 10 — Viya environment awareness | ✅ **done — 10a and 10b both merged, 2026-09-15 and 2026-09-16** (local/remote diff + `Search environment` QuickPick; Pylance stub reflection via generated catch-all stubs and a managed `stubPath`, plus a "Restart Language Server" remedy). A 2026-09-16 deep-dive pass found and fixed the last shadowing gap after several review rounds — a generated stub could displace Pylance's own bundled typeshed (Finding 10.7, new `src/run/typeshedNames.ts`). Final PRs [#178](https://github.com/Shai-Alit/sas-py-vscode/pull/178)/[#182](https://github.com/Shai-Alit/sas-py-vscode/pull/182), squash `62cf217`/`2842722`. `npm run verify` green (1,814 unit; coverage 96.3/95.68/96.08/96.3); `npm run test:integration` green (454 passing). Phase 10→11 housekeeping ran and closed 2026-09-16 (see above). | `docs/phases/phase-10.md` |
| 11 — Remaining parity gaps | ✅ **done — 11a–11e all merged, 2026-09-17–21** (interactive window; CAS/SWAT SQL passthrough; pre-release bugs; CAS table properties/CSV export; session startup). AI-agent integration and CSV-guard research moved to Phase 12, 2026-09-22 ([ADR-0037](docs/adr/0037-ai-agent-integration-approach.md)). Three decided-to-build follow-ups (large-table confirmation for SAS library tables, a `CasProblem` for an oversized response, autoExec-error text) folded into Phase 12 as slice 12f (labeled 12e when folded in; renumbered 12f the same day, once Phase 12's own 12c was inserted ahead of it), not started. Final PRs [#192](https://github.com/Shai-Alit/sas-py-vscode/pull/192)/[#193](https://github.com/Shai-Alit/sas-py-vscode/pull/193)/[#194](https://github.com/Shai-Alit/sas-py-vscode/pull/194)/[#195](https://github.com/Shai-Alit/sas-py-vscode/pull/195)/[#197](https://github.com/Shai-Alit/sas-py-vscode/pull/197)/[#199](https://github.com/Shai-Alit/sas-py-vscode/pull/199). `npm run verify` green (1,856 unit; coverage 96.38/95.85/96.16/96.38); `npm run test:integration` green (495 passing). Phase 11→12 housekeeping ran and closed 2026-09-22 (see above). | `docs/phases/phase-11.md` |
| 12 — AI-agent integration | **started 2026-09-22 — gates v1.0** (`PRODUCTION_PLAN.md` §8). **12a (Agent Skill) shipped 2026-09-22** — `.claude/skills/python-on-viya/SKILL.md`, no production code. **12b (Option C spike) ran 2026-09-22 — viable, go**; the actual build is a separate, not-yet-scoped slice per ADR-0037. **12c (scope the Option C build) scoped 2026-09-22** — read-only v1 tool surface, `headersHelper`-shaped token design, security-review checklist; audience boundary settled by a live Extension Development Host probe (external CLI only for v1 — see `microsoft/vscode`#265912). Inserted ahead of the phase's other slices; a same-day letter collision with a concurrently-merged PR (#207) was found and reconciled (see the narrative above), landing on a uniform shift rather than either branch's original lettering. **12g, 12h and 12i added 2026-09-22** from two pieces of work outside the repository: the `PROC PYTHON` "resuming Python state" `NOTE` and whether it reaches our own transcript (12g, Findings 12.2/12.3); a spike on inline graphics via `SAS.show`/ODS HTML5, build explicitly deferred (12h); and `NOTICE` attribution for the twelve bundled MIT components that ship in `dist/webview/dataViewer.js` (12i). 12d (Python-startup-snippet spike), 12e (CSV-guard research), 12f (three small Phase 11 follow-ups), 12g, 12h and 12i all not started. | `docs/phases/phase-12.md` |
| 13 — Second execution backend | not started — does not gate v1.0 | `docs/phases/phase-13.md` |

Each phase file bundles everything that phase needs: the plan section
(architecture, scope), the runbook punch list (commands, order, barriers), and
the relevant probe findings — so one file is normally all a session needs
beyond this index and the trimmed `RUNBOOK.md` / `PRODUCTION_PLAN.md` cores.

Phase 2b covers what were originally separate "2b" and "2c" labels in the
source runbook — they share one continuous command block in the original
document and don't split cleanly, so they're kept as one phase file here.

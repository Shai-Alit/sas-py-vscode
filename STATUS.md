# Status

**Phase 5 (Hardening & first release) is complete.** `v0.1.1` is the first
published release — VS Marketplace, Open VSX, and GitHub Releases. All Phase 5
slices (5a, 5b, 5c-i–5c-iv, 5d-i–5d-iv) are merged; Viya 3.5 support was dropped
along the way ([ADR-0022](docs/adr/0022-drop-viya-35-support.md)).

**Phase 6 (SAS Content explorer) is fully complete and merged — 6a–6e all landed.** A SAS Content tree (My Favorites / My Folder / SAS Content / Recycle Bin) with open/save via a `sasContent:` `FileSystemProvider`, create/rename/move/delete, drag-and-drop, favourites, a recycle bin, and right-click Cut/Paste as a permanent move alternative ([ADR-0030](docs/adr/0030-delete-recycles-content-items.md), [ADR-0031](docs/adr/0031-content-folder-resource-uri.md), [ADR-0032](docs/adr/0032-content-cut-paste.md)). Final merge: 6e as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162), squash `a74f756`. `npm run verify` green throughout (1580 unit; coverage 95.57/95.51/95.26/95.57). **The Phase 6→7/8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — its only open item, the top-level-folder permanent-delete confirmation, closed as a documented, deferred known gap (a Viya deployment-level install-time configuration, not something this codebase or account permissions control) — see `phase-6.md`'s Runbook and `manual-test-pass.md`'s §15 for the full account. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule — a move that should have happened at the Phase 6→7/8 checkpoint itself but was missed then; caught and fixed at the Phase 8→9 checkpoint instead.

**Phase 7 (Libraries and data viewer) is fully complete — 7a–7d all merged 2026-09-11.** `src/data/` (library/table tree, ADR-0027), the React + ag-grid-community data viewer webview with sort/filter/CSV export (ADR-0028/ADR-0029), the table properties panel, and Python↔SAS-library data exchange via `SAS.sd2df`/`df2sd`/`submit` (7d, no upstream equivalent) are all live. Findings 7.1–7.20 and every phase-specific ADR are in [`docs/phases/phase-7.md`](docs/phases/phase-7.md), which has the full slice-by-slice account. Final merge: 7d as [PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163), squash `7b32db0`. `npm run verify` green throughout (1574 unit tests; coverage 95.62%/95.54%/95.38%/95.62% lines/branches/functions/statements). **The Phase 7→8 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-11** — see the "Phase 7→8 housekeeping" section below for what it found and fixed. The full slice-by-slice narrative that used to live here has moved to [`docs/status-archive.md`](docs/status-archive.md), per this file's own archival rule.

**Phase 8 (CAS and SWAT) is fully complete — 8a–8c all merged 2026-09-14.** A read-only CAS tree (servers, global caslibs, tables, and — once loaded — columns, no compute session needed — [ADR-0033](docs/adr/0033-cas-adapter-shape.md)); `pythonOnViya.insertCasConnectionSnippet` delivers a fresh CAS token via the same never-logged fileref-upload path Python source itself uses, never via inline submitted code (Finding 8.6); and CAS tables open in the same paged, sortable, filterable data-viewer panel Phase 7 built, generalized behind a `TableSource` interface rather than forked or forced through `LibraryAdapter`'s own view machinery ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final merge: 8c as [PR #171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green throughout (1703 unit; coverage 95.92/95.46/95.75/95.92). **The Phase 8→9 between-phase housekeeping (`HOUSEKEEPING.md`) ran and closed 2026-09-14** — see the "Phase 8→9 housekeeping" section below for what it found and fixed. **Three post-merge fixes then landed as [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173), squash `c2478bb`, merged 2026-09-14** — a `dataTable`-relation redirect (Finding 8.14), a CAS filter's error message surfacing an opaque code instead of CAS's own actionable sentence (Finding 8.15), and an attempted tree-icon-refresh fix that live re-confirmation found still does not work, deferred as a known gap to Phase 10/11 (`docs/phases/phase-11.md`) — see `phase-8.md`'s "Post-merge fixes, 2026-09-14" Runbook entry for the full account. The full slice-by-slice narrative that used to live here has moved to `docs/status-archive.md`, per this file's own archival rule.

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

**Phase 10 (Viya environment awareness) is in progress — 10a merged
2026-09-15, 10b implemented, reviewed, fully manually tested (all of
10.1–10.14 green), and opened as
[PR #182](https://github.com/Shai-Alit/sas-py-vscode/pull/182).** 10a
(`docs/phases/phase-10.md`) adds a
local/remote package diff to the existing `Show environment` document (a
new "Local comparison" section, reading the local interpreter
`ms-python.python` has active via `@vscode/python-extension` and
`vscode.workspace.fs`, never `node:fs`) and a new filterable `Python on
Viya: Search environment` `QuickPick`, additive to the existing plain-text
document. Local/remote package names are matched PEP 503-normalised so a
capitalisation difference alone is never reported as a false mismatch.
`npm run verify`'s full chain and `npm run test:integration` both green
throughout (see `phase-10.md`'s own "10a verification" Runbook entry for
numbers). **The pre-push adversarial self-review and two rounds of PR
review together found and fixed four real defects**, all in
`src/run/localPythonEnvironment.ts`: an unguarded
`getActiveEnvironmentPath`/`resolveEnvironment` pair that could propagate a
local-Python-extension error and blank the whole `Show environment`
document instead of degrading only the new "Local comparison" section;
trusting `ResolvedEnvironment`'s declared type over its real runtime shape
(`sysPrefix`/`version.major`/`version.minor` can come back empty/undefined
despite the type, a documented vscode-python defect,
[microsoft/vscode-python#20147](https://github.com/microsoft/vscode-python/issues/20147)),
which would have silently reported every remote package as "remote-only";
an unguarded bare `process.platform` read that could do the same
document-blanking under a hypothetical web extension host; and an unused
`version` field on `LocalEnvironment`'s `known` arm, dropped. Full account
in `phase-10.md`'s Runbook. Manual-test items 10.1–10.5
(`docs/dev/manual-tests/phase-10.md`) all passed (Sean, 2026-09-15). **Final
merge: 10a as [PR #178](https://github.com/Shai-Alit/sas-py-vscode/pull/178),
squash `62cf217`.** `npm run verify` green throughout (1771 unit; coverage
96.09/95.57/95.98/96.09); `npm run test:integration` green (436 passing).
**10b (Pylance environment reflection) is implemented and locally
verified, not yet reviewed, manually tested, or opened as a PR.** Its own
first task — the hands-on stub-path spike the Runbook named as needing an
interactive session — ran this session via the `pyright` CLI (the
open-source engine Pylance is built on) rather than a live VS Code window,
since even Claude Code running directly on the developer's machine has no
tool that can drive VS Code's UI or read its Problems panel; see
`phase-10.md`'s "10b spike" Runbook entry. The spike settled both of its own
questions (a `stubPath` change needs a window reload; a reload is always
needed, not only sometimes) and surfaced one more, unplanned finding before
any stub-generation code was written: a generated stub takes precedence over
a same-named package that already resolves locally with real source,
silently disabling real type-checking for it (Finding 10.2) — so stub
generation is scoped to 10a's `remoteOnly` diff bucket, never every remote
package as the Plan section originally described. A second design point (the
existing Stage-2 probe only reports the PyPI *distribution* name, not the
*import* name Pylance actually needs — `Pillow`/`PIL`, `beautifulsoup4`/`bs4`,
and others) was raised to the developer before any code was written and
decided: extend the probe's payload, not ship a feature that silently
under-covers common packages. New: `src/run/stubGenerator.ts`,
`src/run/stubPathSetting.ts` (pure, 100% unit-covered), and
`src/run/pylanceStubSync.ts` (the `vscode`-importing shell — generated stubs
live at their own `.pythonOnViya/typings/`, never the conventional bare
`typings/`, and `python.analysis.stubPath` is written via
`vscode.workspace.getConfiguration(...).update(...)` — the sanctioned API,
simpler and safer than the hand-rolled JSON merge the Runbook originally
planned — only when nothing already claims that setting at workspace scope).
`npm run verify`'s full chain and `npm run test:integration` both green (see
`phase-10.md`'s "10b verification" Runbook entry for numbers). Manual-test
items 10.6–10.11 (`docs/dev/manual-tests/phase-10.md`) are written but not
yet run — they need a real VS Code+Pylance window, which this session cannot
open. **The pre-push adversarial self-review has now run and found four real,
blocking defects, all fixed on this branch** — Finding 10.2's shadowing
mitigation was only half the hazard (a generated stub could still shadow the
user's own workspace source, not just an installed local package); the reload
notice nagged on every unchanged refresh; `Search Environment` silently wrote
to the workspace with no signal to the user; and three bare `catch {}` blocks
discarded the real cause of a write failure, one of which could silently skip
pruning a stale, shadowing stub. Full account, including the review's
non-blocking items folded in and the ones left open for the developer to
decide, in `phase-10.md`'s own "Adversarial self-review, 2026-09-15" Runbook
entry. The four discussed-not-decided items from that pass were resolved with
the developer the same day: `workspaceFolderValue` settled with evidence (no
code change — only diverges from `workspaceValue` in a real multi-root
workspace, out of scope today, carried to `phase-11.md`); local-unknown
stubbing every remote package kept as-is; a `pythonOnViya.*` opt-out setting
deferred to `phase-11.md`; and a "Reload Window" action button built onto the
reload notice. **The developer then ran their own independent adversarial
pass against the full branch** (`git diff main`, plus the allowed static
gates run by hand) and found two more real findings: `commands.ts`'s own 10b
wiring had a real injection seam nothing used, so the `changed`-based no-nag
fix above was itself untested at the wiring level — fixed with a new
purpose-built probe fixture (`test/helpers/recorded-probe-connection.ts`) and
five new integration tests; and unsanitised Viya-sourced `name`/`version`
strings could escape a generated stub's `#` comment via a newline — fixed
(`stubGenerator.ts`'s new `sanitiseForComment`). Full account in
`phase-10.md`'s Runbook. `npm run verify`'s full chain (1813 unit; coverage
96.17/95.63/96.05/96.17), `npm run test:integration` (443 passing), and
`npm run check:secrets` (502 files — this session also caught its own gap:
`check:secrets` reads `git ls-files`, so new files went unscanned until
staged) all green after every fix above.

**Manual-test pass (items 10.6–10.14), run 2026-09-15 (Sean, real VS
Code+Pylance window) — 8 of 9 passed; §10.8 is open, and a separate design
objection came out of the same session.** 10.6, 10.7, 10.9–10.14 all passed
(`docs/dev/manual-tests/phase-10.md` has the per-item detail, including a
first-attempt false start on §10.8 with `saspy` — discarded once traced to a
stub already on disk from an earlier test today, unrelated to the feature's
own sync — and a first-attempt failure on §10.9 with nothing logged, not
reproduced on retry, cause not established). **§10.8 itself failed and is
still open**: against `babel` (confirmed never previously stubbed), a fresh
probe correctly left the `reportMissingImports` diagnostic unchanged before
any reload — but after accepting the "reload the window" notice and
completing a real reload, the diagnostic still did not clear or downgrade.
Root cause not investigated, at the developer's own direction. Recorded as
**Finding 10.3** (`phase-10.md`'s Probe findings section — open, not
resolved) and in the Runbook's "Manual test session, 2026-09-15" entry.
**Separately, the developer has flagged the reload-required design itself as
unacceptable, independent of whether §10.8 is a distinct bug**: a ~60–90
second full extension-host restart — every extension restarting, the current
Viya connection dropped and needing a manual reconnect — every time a
refresh changes the remote-only package set, in exchange for a bare,
attribute-less catch-all stub, is judged too costly as currently built. Full
account, including candidate directions not yet evaluated, in the same
Runbook entry. **The reload-design objection has since been acted on:** a
"Restart Language Server" action is now offered alongside "Reload Window" on
every stub-changing refresh (`src/run/commands.ts`'s new `offerReloadRemedy`),
matching Pylance's own troubleshooting docs' recommendation for a
`python.analysis.*` change — it restarts only the language-server process,
not the whole extension host, so it has no structural reason to touch this
project's own Viya connection or any other extension. The button is only
offered when `python.analysis.restartLanguageServer` is actually registered
(checked live via `vscode.commands.getCommands()`), and a registered-but-
failing restart is caught and falls back to offering the reload, never a
silent dead end. The real command id was confirmed against a live installed
`ms-python.python` 2026.4.0, not assumed from a bug report — **Finding 10.4**
(`phase-10.md`). `npm run verify`'s full chain green (1813 unit tests,
coverage unchanged at 96.17/95.63/96.05/96.17 — `src/run/commands.ts` stays
outside the coverage tier, same as before this change). Full account in
`phase-10.md`'s Runbook, "Design change implemented, 2026-09-15" entry.
**The pre-push adversarial self-review of this design change has now run
and found two small, non-blocking issues, both fixed**: an unhandled-
rejection gap on `offerReloadRemedy`'s call site, and two dev-machine
artefacts (`.vscode/settings.json` residue; `.pythonOnViya/` untracked
because this repo's own `.gitignore` didn't exclude it, unlike what
`docs/python-environment.md` tells users to do for theirs) — full account in
`phase-10.md`'s Runbook, "Pre-push adversarial self-review of the design
change, 2026-09-15" entry. **§10.8 re-tested live against this change,
2026-09-15 — passed.** Against `requests` (confirmed never previously
stubbed): uninstalling it locally produced `reportMissingImports`; a fresh
probe correctly left that unchanged; clicking **Restart Language Server**
(~5–10 seconds, no dropped Viya connection) downgraded it to
`reportMissingModuleSource` as expected. Recorded as **Finding 10.5**
(`phase-10.md`) — which directly contradicts Finding 10.3's own `babel`
result under a full reload alone, a discrepancy neither finding explains.
**The developer's own call: Finding 10.3's `babel` result is set aside as a
likely mistake in how that attempt was run, not a reproduced defect** — left
in place verbatim as the historical record, no longer treated as blocking.
§10.8 is marked passed on Finding 10.5's strength. **The full manual-test
board for Phase 10 (items 10.1–10.14) is now all green.** **10b opened as
[PR #182](https://github.com/Shai-Alit/sas-py-vscode/pull/182)**, branch
`feat/phase-10b-pylance-stub-reflection` against `main` — awaiting review
and merge.

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

## Open items carried forward

- **Open VSX namespace claim** — file the "Request ownership of a namespace"
  issue on `EclipseFdn/open-vsx.org` for the `shai-alit` namespace (Sean's
  Eclipse Foundation account) to clear the ⚠️ unverified-publisher warning on
  every release. Blocks nothing; trust-signal only.
- **5d-i user-provided-CA live test** — the one unrun `manual-test-pass.md` row
  (§3). Needs a deployment whose certificate chain the OS does not already
  trust. Run it when such an environment exists.
- **Phase 11 (parity gaps):** Accounts-menu legibility — with two profiles
  signed in, VS Code shows separate rows but they don't identify the extension
  or which profile each is (`Sean Ford (SAS Viya)` vs `sean.ford@sas.com
  (Microsoft)`). Recorded in `docs/phases/phase-11.md`; related to
  [#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42).
- **Phase 10/11 (known gap):** a CAS tree table's icon does not flip from
  "unloaded" to "loaded" after a JIT-load-on-expand, in a real VS Code
  window — a fix landed and was refined twice over [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173)'s
  own review, passes every unit/integration test written against it, and
  still doesn't work live (Sean, 2026-09-14). Root cause not found; needs a
  live debugging session against a real `vscode.TreeView`, not just this
  project's own fake-emitter test tiers. Recorded in
  `docs/phases/phase-11.md` and `phase-8.md`'s "Post-merge fixes,
  2026-09-14" Runbook entry.
- **Hosted docs site** — deliberately **not planned**, and explicitly *not* a
  1.0 gate (`PRODUCTION_PLAN.md` §8, "Definition of done — 1.0"). The VitePress
  build runs as a CI link-check gate; nothing deploys the output. A standalone
  task if ever revisited, not a phase slice.

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
| 8 — CAS and SWAT | ✅ **done — 8a–8c all merged.** CAS browsing tree ([ADR-0033](docs/adr/0033-cas-adapter-shape.md)), authenticated CAS session helper, CAS tables in the data viewer via a `TableSource` abstraction ([ADR-0034](docs/adr/0034-table-source-abstraction.md)). Final PR [#171](https://github.com/Shai-Alit/sas-py-vscode/pull/171), squash `bb80b92`. `npm run coverage` green (1703 unit; coverage 95.92/95.46/95.75/95.92). Phase 8→9 housekeeping ran and closed 2026-09-14 (see above). Three post-merge fixes landed as [PR #173](https://github.com/Shai-Alit/sas-py-vscode/pull/173), squash `c2478bb`, merged 2026-09-14 — one known gap (tree icon refresh) deferred to Phase 10/11. | `docs/phases/phase-8.md` |
| 9 — Notebooks | ✅ **done — 9a–9d all merged or decided, 2026-09-14/15.** ipynb-native execution, no `ms-toolsai.jupyter` dependency, against the notebook's own compute session ([ADR-0035](docs/adr/0035-notebook-gets-its-own-compute-session.md)); cell output via VS Code's own built-in `notebook-renderers` extension, `text/html` sanitized first ([ADR-0036](docs/adr/0036-notebook-html-output-is-sanitized.md)); Problems-panel diagnostics for a raised cell. 9d (export) scoped and dropped outright — ipynb's own portability and VS Code core's native per-output commands already cover it. Final PRs [#172](https://github.com/Shai-Alit/sas-py-vscode/pull/172)/[#176](https://github.com/Shai-Alit/sas-py-vscode/pull/176)/[#177](https://github.com/Shai-Alit/sas-py-vscode/pull/177), squash `6884e49`/`9eca850`/`fa7222f`. `npm run verify` green (1753 unit, 96.04/95.51/95.9/96.04); `npm run test:integration` green (433 passing). Phase 9→10 housekeeping ran and closed 2026-09-15 (see above). | `docs/phases/phase-9.md` |
| 10 — Viya environment awareness | 🔶 **in progress — 10a merged 2026-09-15** (local/remote diff + Search environment `QuickPick`). Final PR [#178](https://github.com/Shai-Alit/sas-py-vscode/pull/178), squash `62cf217`. **10b (Pylance stub reflection) implemented 2026-09-15; a pre-push self-review and then the developer's own independent adversarial pass both ran the same day, together finding six real defects, all fixed on the branch** — `npm run verify` green (1813 unit; coverage 96.17/95.63/96.05/96.17); `npm run test:integration` green (443 passing). Manual test (items 10.6–10.14) and PR still to come. | `docs/phases/phase-10.md` |
| 11 — Remaining parity gaps | not started | `docs/phases/phase-11.md` |
| 12 — Second execution backend | not started | `docs/phases/phase-12.md` |

Each phase file bundles everything that phase needs: the plan section
(architecture, scope), the runbook punch list (commands, order, barriers), and
the relevant probe findings — so one file is normally all a session needs
beyond this index and the trimmed `RUNBOOK.md` / `PRODUCTION_PLAN.md` cores.

Phase 2b covers what were originally separate "2b" and "2c" labels in the
source runbook — they share one continuous command block in the original
document and don't split cleanly, so they're kept as one phase file here.

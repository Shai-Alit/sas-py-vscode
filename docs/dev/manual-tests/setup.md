<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — setup

The three tiers in [Testing](../testing.md) prove the extension calls the right things in the right order. None of them proves a person can install the built `.vsix`, point it at a real deployment, and get a figure back. This is that proof: a scripted walkthrough of every user-visible behaviour shipped so far, run by hand against a live Viya 4 deployment with the packaged extension installed.

Run it before a release ([release checklist](../../release-checklist.md) D6), and again whenever a phase closes.

**This page used to be one file, `docs/dev/manual-test-pass.md`.** It is now split one file per phase, plus this setup file and [`misc.md`](misc.md) for the phase-agnostic checks, so a session working one phase only has to open one file, and a new phase can never silently share (or get lost inside) another phase's file. That file is now a stub pointing here. Every test everywhere in this split carries a stable number (`S.1`, `1.1`, `6.4`, `M.2`, …) instead of a bare bullet, so it can always be referenced exactly, the same convention this project's probe findings already use.

## Index

| File | Covers |
|---|---|
| `setup.md` (this file) | Pre-flight, activation — phase-agnostic, run first |
| [`phase-1.md`](phase-1.md) | Connection profiles, sign-in — phase 1a/1b |
| [`phase-2.md`](phase-2.md) | Connect and the compute session — phase 2a |
| [`phase-3.md`](phase-3.md) | Run Python: run target, text output, tracebacks, rich output, environment — phases 3a–3e |
| [`phase-4.md`](phase-4.md) | Diagnostics: Problems panel, Show Environment pointer, traceback reveal — phases 4c/4d |
| [`phase-5.md`](phase-5.md) | Hardening: user-provided CA, traceback dedup, Problems-entry lifecycle — phases 5d-i/5d-iii/5d-iv |
| [`phase-6.md`](phase-6.md) | SAS Content: browsing, open/save, mutations, favourites, Recycle Bin — phases 6a–6e |
| [`phase-7.md`](phase-7.md) | SAS Libraries, data viewer, sort/filter, table properties, Python↔library data exchange — phases 7a–7d |
| `phase-8.md` … `phase-12.md` | Stubs — no manual tests yet, these phases have not started |
| [`misc.md`](misc.md) | Trust/enablement and regression spot-checks — phase-agnostic, run every pass |

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


## History of full passes

The chronological log below predates this split (it was written against the single `manual-test-pass.md` file) and its own `§N` references are to that old, single-file numbering — kept verbatim as a historical record rather than rewritten, per this project's own "never rewrite history" convention. For where a `§N` item lives now, see the Index above: `§2`–`§3` → `phase-1.md`, `§4` → `phase-2.md`, `§5`–`§9` → `phase-3.md` (plus `phase-4.md`/`phase-5.md` for the items that carried a deeper phase tag), `§10`–`§13`/`§17` → `phase-7.md`, `§15`–`§16` → `phase-6.md`, `§0`–`§1` → this file, `§14`/`§18` → `misc.md`.

**Last full pass: 2026-09-09** (Phase 5→6 boundary), against live `verde` (SSO)
and `Innov` (SAS corporate creds) profiles with the published `.vsix`. **All
sections passed except §3's user-provided-CA row (5d-i)**, which needs a
deployment whose chain the OS does not trust — none is available, and it stays
`[ ]` and deferred, as `phase-5.md`'s 5d-i entry already records. Three notes,
none blocking Phase 6: a nuance in §4 (reload-reconnect may re-prompt for auth
on a password-backed profile — expected, not a defect), a **bug** in §4 (fileref
collision after a full VS Code restart on a session with many accumulated
filerefs — Finding 72's fix does not paginate; a standalone `fix/` PR lands
before Phase 6), and an Accounts-menu observation in §3 carried to Phase 11. The
2026-08-27/30/31 history below is kept for context.

**Earlier full pass: 2026-08-27**, against live `verde`/`Innov` profiles with the
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

**Targeted re-check, 2026-09-02** (not a full pass) — for phase 5d-iii
(Finding 74), against `verde` with a `.vsix` from `phase-5d-iii-finding-74`:
§7's new "Traceback is not echoed or mangled after the outcome" row verified
live across **ten runs** — five scripts (recursion, `raise ValueError`,
`import nosuchpkg`, own-`>>>`-output-then-raise, figure-then-raise) plus a
successful run, each under **Run Selection** and **Run File**. The output
channel ends at "Finished with an error." with no repeated exception line
(the `ModuleNotFoundError` superset line still prints, by design); the
Result panel shows no third copy of the message and no trailing `>>>` on
the structured message; a program's own `>>>`/`...` stdout is untouched.
The synthesized-fallback and SAS-side-`SYSERRORTEXT` sub-cases were left to
unit/integration coverage. **Sub-finding (a) — refined:** the interpreter
banner appears on every **Run File** run (it tracks the `restart`, success
or failure), and bare `>>>` markers appear on **every** run of either mode —
so §6's "Hello world streams clean" no longer holds for Run File. Not a
5d-iii regression (the stream is untouched); folded into that §6 box's note
and the live-Viya probe.

**Phase 5→6 between-phase housekeeping, 2026-09-09.** The Finding 74 / §6
banner-and-`>>>` question is now **closed** — probed against `verde`
(Finding 93, `docs/phases/phase-5.md`): no `PROC PYTHON` option suppresses the
interpreter banner or the `>>>` prompts, so it is accepted as known behaviour
and the §6 boxes are reworded, not left as open contradictions. **The full
pass ran 2026-09-09** (see the "Last full pass" note above) — the first since
2026-08-27; all of Phase 4 and Phase 5 in between had only targeted re-checks.
Everything passed bar the 5d-i CA row (no environment); three notes are folded
into §3/§4, one of them a fileref-pagination bug getting a standalone `fix/` PR
before Phase 6.


## Pre-flight


- [x] **S.1** **Build the VSIX** — `npm run package` from the repo root.
  **Expect:** `vsce package` writes `dist/python-on-viya.vsix` and
  `check:package` passes (the manifest lists ~10 entries, LICENSE and NOTICE
  included).
- [x] **S.2** **Install it into a real VS Code** — Extensions view → **⋯** → **Install
  from VSIX…**, or `code --install-extension dist/python-on-viya.vsix`. Reload.
  **Expect:** “Python on Viya” shows as installed; no activation error.
- [x] **S.3** **Install `ms-python.python`** in the same window.
  **Expect:** needed for completion/hover (editing intelligence is delegated)
  and for the editor run-button check in §5.
- [x] **S.4** **Open a trusted folder with a `.py` file.** Have a Viya 4 deployment
  reachable and know one compute context whose SAS server has the Python
  interpreter configured.
- [x] **S.5** **Open the log** — run **Python on Viya: Show Log** and dock it.
  **Expect:** a clean “Python on Viya activated.” line.


## Activation and logging

- [x] **S.6** **Activates on startup**, no command needed. Reload and wait.
  **Expect:** activation on `onStartupFinished`; nothing alarming in the log.
- [x] **S.7** **The palette only offers what is valid now.** Type “Python on Viya”.
  **Expect:** with no profile and a Local target you see _Add Connection
  Profile_, _Import Connection Profiles…_, _Select Run Target_, _Show Log_ —
  and **not** _Connect_, _Disconnect_, _Cancel_. Unavailable commands are
  omitted, not greyed.


## Keeping this current

- **This file and `misc.md` are phase-agnostic** — pre-flight, activation, trust, enablement and the regression spot-checks apply to every build. `misc.md`'s regression section grows by one item each time review catches a defect worth re-confirming by hand.
- **Every other phase gets its own file.** When a phase closes, add a numbered item (or a new file, for a phase that doesn't have one yet) for its user-visible behaviour, citing the slice and ADR the same way the existing items do, numbered as the next `N.M` in that phase's file.
- **Retire a gap when it closes.** A **(known gap)** item is a promise to update it, not a permanent excuse. When the behaviour lands, rewrite the item as a normal **Expect**.
- **Re-run the whole thing before a release** — it is [release checklist](../../release-checklist.md) D6, and “publishing green is not the same as working”.

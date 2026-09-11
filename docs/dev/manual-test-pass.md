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

- [x] **Build the VSIX** — `npm run package` from the repo root.
  **Expect:** `vsce package` writes `dist/python-on-viya.vsix` and
  `check:package` passes (the manifest lists ~10 entries, LICENSE and NOTICE
  included).
- [x] **Install it into a real VS Code** — Extensions view → **⋯** → **Install
  from VSIX…**, or `code --install-extension dist/python-on-viya.vsix`. Reload.
  **Expect:** “Python on Viya” shows as installed; no activation error.
- [x] **Install `ms-python.python`** in the same window.
  **Expect:** needed for completion/hover (editing intelligence is delegated)
  and for the editor run-button check in §5.
- [x] **Open a trusted folder with a `.py` file.** Have a Viya 4 deployment
  reachable and know one compute context whose SAS server has the Python
  interpreter configured.
- [x] **Open the log** — run **Python on Viya: Show Log** and dock it.
  **Expect:** a clean “Python on Viya activated.” line.

## 1. Activation and logging

- [x] **Activates on startup**, no command needed. Reload and wait.
  **Expect:** activation on `onStartupFinished`; nothing alarming in the log.
- [x] **The palette only offers what is valid now.** Type “Python on Viya”.
  **Expect:** with no profile and a Local target you see _Add Connection
  Profile_, _Import Connection Profiles…_, _Select Run Target_, _Show Log_ —
  and **not** _Connect_, _Disconnect_, _Cancel_. Unavailable commands are
  omitted, not greyed.

## 2. Connection profiles — phase 1a

The profile _model_ is validated whether you use the commands or hand-edit
`settings.json`. Secrets never live in settings.

- [x] **Add a profile** — a name, an `https://…` endpoint, context and client id
  left empty.
  **Expect:** “Added connection profile …” toast; the status bar shows the name.
- [x] **Endpoint validation rejects the dangerous shapes** — try
  `http://viya.example.com` (non-loopback http) and `https://user:pw@host`.
  **Expect:** both refused with a specific reason (token readable over http;
  credentials do not belong in a settings file).
- [x] **Settings shape is right** — inspect `pythonOnViya.connectionProfiles`.
  **Expect:** keyed by name, each entry carrying a `version` and a generated
  `id`, and **no** client secret anywhere.
- [x] **Hand-editing is picked up and re-validated** — change a profile's
  endpoint in `settings.json`, then break another (drop the scheme).
  **Expect:** the valid edit takes effect; the broken one is ignored with a log
  line naming which and why, not a whole-setting failure.
- [x] **`defaultProfile` vs Switch** — `pythonOnViya.defaultProfile` is a
  **Settings UI / `settings.json` value, not a command** — it will never appear
  in the Command Palette by design (confirmed against `package.json`'s
  `contributes.configuration`; the 2026-08-27 pass looked for it in the
  Palette and reasonably didn't find it). Set it via **Settings → search
  "Python on Viya" → Default Profile**, or `settings.json` directly, then
  reload; then **Switch Connection Profile** to another.
  **Expect:** a fresh window starts on `defaultProfile`; switching overrides it
  for this window only and does not rewrite the setting. *(Not yet re-run
  against the corrected steps — do that before ticking this box.)*
- [x] **Edit and Delete** — **Edit Connection Profile** (change endpoint, leave
  the secret prompt blank); **Delete Connection Profile**.
  **Expect:** edit updates in place and keeps the stored secret; delete removes
  the entry and drops its secret from secret storage.
- [x] **(slow) One-time import from the SAS extension** — only if that extension
  is installed with profiles: **Import Connection Profiles from the SAS
  Extension**.
  **Expect:** Viya profiles copied once; non-Viya kinds skipped.

## 3. Sign in — phase 1b

- [x] **(live) OAuth2 + PKCE round trip** — run **Sign In**.
  **Expect:** the system browser opens SASLogon; you land back in VS Code. On a
  stock Viya 4 that is the paste-box arm; the URI-handler arm only fires with an
  admin-registered client. Signing in also opens a compute session.
- [x] **(live) Empty client id uses the built-in client** — profile with
  `clientId` empty.
  **Expect:** the built-in `vscode` client on Viya 4 2022.11+. On an older Viya
  4 you are told, in those words, to supply an id and secret. _(Viya 3.5
  support is dropped —
  [ADR-0022](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/adr/0022-drop-viya-35-support.md)
  — nothing to test.)_
- [x] **Sign out** — run **Sign Out**, then trigger a run.
  **Expect:** you are taken back through authentication. **Failed, 2026-08-27**
  — clicking **Run File** after sign-out silently fails instead ("The program
  could not be sent to SAS Viya…", nothing in the log, no re-auth prompt).
  Root-caused and tracked as Phase 3's **3f** slice (`docs/phases/phase-3.md`)
  — re-run this item once that lands. **Retested 2026-09-09: passes** — Sign
  Out then Run File takes you back through auth.
- [x] **(live) Accounts menu with two profiles signed in** — sign into two
  profiles whose auth flows differ (e.g. an SSO Viya profile and a
  corporate-creds one).
  **Expect:** both appear as separate rows. **Observed 2026-09-09:** they do —
  refining [#42](https://github.com/Shai-Alit/sas-py-vscode/issues/42), which is
  about the collapse that happens only when two profiles produce the *same*
  `account.label`. Two open points, not defects for this box: the rows do not
  identify themselves as **Python on Viya** or say which profile each is (one
  showed as `Sean Ford (SAS Viya)`, the other as `sean.ford@sas.com
  (Microsoft)` — the parenthetical is the auth provider's name, and the
  `(Microsoft)` label for a corporate-creds profile is itself confusing). Both
  carried to **Phase 11** (parity gaps) — see `docs/phases/phase-11.md`.
- [x] **(live) (slow) Proxy / internal CA** — only if applicable: sign in as
  normal.
  **Expect:** it completes; proxy and OS/internal certificate trust are
  inherited from the extension host.
- [ ] **(live) User-provided CA certificate — phase 5d-i** — only on a
  deployment whose chain the OS does *not* already trust (an incomplete chain,
  or a private root not installed locally). First sign in with
  `pythonOnViya.userProvidedCertificates` unset.
  **Expect:** sign-in fails before authentication with a TLS error
  (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `unable to verify the first
  certificate`) in the **Python on Viya** log. Then set the setting to the PEM
  path for the missing authority, reload the window, and sign in again.
  **Expect:** sign-in completes and a run works — the same dedicated agent is
  on both paths. Add a second, bogus path to the array and reload.
  **Expect:** a single **Could not read the CA certificate at …** warning in
  the log, naming that path, and sign-in still works on the good one.

## 4. Connect and the compute session — phase 2a

One session per folder, per profile ([ADR-0012](../adr/0012-compute-session-lifetime-and-storage.md)).
Reload reconnects; it does not restart.

- [x] **(live) Cold-start Connect** — signed out, run **Connect to SAS Viya**.
  **Expect:** it signs you in first, shows a progress notification while the
  session opens, then an info message naming the profile. **Failed,
  2026-08-27** — while signed out, **Connect to SAS Viya** does not appear in
  the palette at all; **Sign In** has to be run manually first, and only then
  does Connect appear. Tracked in Phase 3's **3f** slice alongside the other
  "Connect won't come back" findings below — re-run once that lands.
- [x] **(live) Context picker and write-back** — profile with no `context`: the
  first connect lists contexts. Dismiss it once; connect again and pick a
  working one.
  **Expect:** dismiss → connect cancels, nothing written. After a session
  actually starts, `context` is written back into the profile in
  `settings.json`.
- [x] **(live) Reload reconnects with state intact** — run selection `k = 99`
  (see §6). Reload the window. Run selection `print(k)`.
  **Expect:** `99` — you re-attached to the same interpreter. **Failed,
  2026-08-27** — a window reload lost the Viya connection and left **Connect**
  missing from the palette (same underlying cause as Cold-start Connect and
  Idle reap below — see Phase 3's **3f** slice). **Retested 2026-08-30
  against the 3f fix build: Connect no longer goes missing, but the first
  submission after reload still failed** — a fileref collision ("`py000001`
  already exists", error 5402), reproduced one fileref number later after
  **Reset Python State**, clearing on its own after roughly 60–90 seconds
  (Finding 72). **Root-caused and fixed 2026-08-31** on
  `phase-3f-manual-test-regressions`: the backend now seeds its per-run
  fileref counter from the session's own `filerefs` collection on the
  first run after reconnecting, so it never re-issues a name the
  reattached session already holds, with a bounded assign-retry as a
  backstop. **Re-verified live 2026-08-31** against a `.vsix` from this
  branch: `k = 99`, reload, `print(k)` returns `99` on the first attempt
  with no delay.
  **Full-pass re-run 2026-09-09** (published `.vsix`, profiles A `verde`/SSO
  and B `Innov`/SAS-corporate-creds): reload-with-state passes on both, with
  **one nuance and one bug.**
  - *Nuance (not a defect):* the reconnect after reload may need re-auth,
    depending on the profile's auth flow. Profile B (password-backed corporate
    creds) re-opened the browser sign-in on the `print(k)` after reload, then
    returned `99` cleanly with no delay; profile A (SSO, no password) reconnected
    silently and printed `99`. The re-auth is the IdP's, not the extension's.
  - *Bug (tracked — standalone `fix/` PR before Phase 6):* after **fully
    quitting and reopening VS Code** (not a reload) on a folder whose session had
    accumulated many runs — the §6 corpus plus more — the first run failed with
    `The fileref "py000026" already exists … (16 names tried, all already
    assigned)`. Root cause: `listFilerefNames` (`src/compute/fileref.ts`) reads
    only the first page of the session's fileref collection, so
    `seedFilerefCounter` (Finding 72's fix) under-seeds when the reattached
    session holds more than one page of `PYnnnnnn` names, and the 16-attempt
    retry cannot close the gap. **Disconnect → Connect** clears it (it opens a
    brand-new session). This is Finding 72's fix being incomplete for the
    many-filerefs reattach case.
- [x] **(live) Disconnect ends it now** — run **Disconnect from SAS Viya**, then
  run selection `print(k)` again.
  **Expect:** a fresh interpreter opens and `k` is gone (`NameError`).
- [x] **(live) Shared vs independent sessions** — a plain **File → Open
  Folder** on an already-open folder just refocuses the existing window — VS
  Code's own behavior, not this extension's, and it is *not* a second window.
  To actually get two independent windows on the same folder, open a terminal
  and run `code -n <folder>` (or use **File → Duplicate Workspace**), *then*
  set a var in one, read it in the other, and switch to a second profile and
  connect in the second window.
  **Expect:** same folder + same profile → one shared session; a different
  profile → its own, the first undisturbed. *(The 2026-08-27 pass used a plain
  Open Folder and was correctly kicked back to the original window — not a
  defect, but not a real test of this item either. Re-run with `code -n`
  before ticking this box.)*
- [x] **(live) (slow) Idle reap** — connect, leave idle past the deployment
  timeout (15 min default).
  **Expect:** the next connect silently opens a fresh interpreter — the stale
  session id is a hint, not a fact, and you are not prompted. **Failed,
  2026-08-27** — same as Cold-start Connect and Reload above: **Connect**
  doesn't reappear in the palette after the reap is detected; only running
  **Disconnect** first brings it back. Tracked in Phase 3's **3f** slice.
  **Retested 2026-08-30 against the 3f fix build: passes** — the next
  connect after a reap silently opens a fresh interpreter, and **Connect**
  never goes missing from the palette. Confirms the connected-key fix for
  this symptom; unlike Reload (above), no new defect turned up here.
- [x] **(live) Error surfaces read sensibly** — reach what you can: Viya target
  with no active profile; a context you can see but cannot launch; Cancel
  mid-connect.
  **Expect:** “Select a … profile”; a two-readings message; **silence** after
  Cancel. **Show Log** carries status codes and correlation ids.

## 5. Run target: Local vs Viya — phase 3d-i

The target governs _where_ our commands appear, never what they do. An
unconfigured workspace is Local and contributes nothing to the editor
([ADR-0011](../adr/0011-choosing-where-python-runs.md),
[ADR-0020](../adr/0020-run-target-defaults-to-local.md)).

- [x] **Fresh workspace is Local and invisible in the editor** — new folder, a
  `.py` file, nothing configured.
  **Expect:** the status bar names the target **Local**; there is **no** run
  icon of ours in the editor title bar, and our _Run File_ / _Run Selection_
  are absent from the editor context menu.
- [x] **Select Run Target sets target + profile together** — **Select Run
  Target** → a Viya profile.
  **Expect:** one gesture sets both. Choosing **Local** again removes our editor
  contributions.
- [x] **Viya target with no profile** — switch the target to Viya before picking
  a profile, then try to run.
  **Expect:** a “no profile selected” readiness state — you are told to pick
  one, not dropped back to Local. **Note (2026-08-27):** with one or more
  profiles already configured, the picker doesn't actually offer a bare
  "Viya, no profile" state — choosing Viya always selects a profile in the
  same gesture. Confirmed as acceptable, intentional UX (not a defect) — the
  literal no-profile state is really only reachable from a completely
  profile-less workspace.
- [x] **Editor button merges with `ms-python`, not doubles** — target = Viya,
  folder trusted, `ms-python.python` installed, a `.py` file open.
  **Expect:** one play button with a dropdown chevron, not two side by side.
  Note which command the tooltip names as primary, and that it does not flip
  around as you use the dropdown. **(known gap)** no keybinding ships — palette
  / button / menu only. Confirmed 2026-08-27: no doubles — **Run File** runs
  on Viya, **Run Python File** runs locally.
- [x] **Context-menu entries gated correctly** — right-click with Viya +
  trusted, then Local, then untrusted.
  **Expect:** our _Run File_ / _Run Selection_ appear only under Viya + trusted.
- [x] **Flipping the target changes placement only** — toggle Local ↔ Viya,
  invoking _Run File_ from the palette each time.
  **Expect:** the command always means the same thing; only whether it also
  appears in the editor changes.

## 6. Running Python: text output — phases 3a, 3b

- [x] **(live) Hello world streams clean** — a file that is
  `print("hello from viya")` → **Run File**.
  **Expect:** a run header, then `hello from viya` as plain stdout, then a
  “Finished” line, with **no SAS NOTEs** and **no page-break banners**
  (`PAGESIZE=MAX`, 3f). The interpreter startup banner
  (`Python 3.12.12 … / Type "help" …`) **does** appear on a **Run File** (which
  restarts the interpreter first) and on the **first Run Selection after
  connect / Reset Python State**; bare `>>>` prompt markers appear on **every**
  run of either command. Both are `PROC PYTHON`'s own interactive-REPL output —
  **known, accepted, not a defect.**
  **Settled 2026-09-09 (Finding 93, `docs/phases/phase-5.md`; Phase 5→6
  housekeeping):** this is Finding 74's sub-finding (a). A live probe pulled
  `PROC PYTHON`'s full option list off the deployment's own syntax-error
  enumeration — `COMMAND ECHO INFILE RESTART SRC TERMINATE TIMEOUT` — and
  **none suppresses the banner or `>>>`** (`ECHO` only adds a source echo).
  There is no `PAGESIZE=MAX`-style fix. Decision: accept and document rather
  than filter `normal`-typed lines client-side (a program may legitimately
  `print(">>> …")`). This box's assertion is reworded accordingly; do not
  re-flag the banner/`>>>` as a regression.
- [x] **(live) Submission fidelity — run the whole corpus.** Open each file under
  `test/fixtures/submission-corpus/` and **Run File**:

  ```
  apostrophe-in-docstring.py         fstring-nested-quotes-braces.py
  ampersand-percent-in-literals.py   crlf-line-endings.py
  non-ascii.py                       tab-indented.py
  no-trailing-newline.py             odd-quote-count.py
  triple-quote-mixed-styles.py       raw-and-byte-strings.py
  semicolon-heavy-oneliner.py        endsubmit-in-string.py
  endsubmit-in-comment.py            empty.py
  utf8-bom.py
  ```

  **Expect:** every file runs and does exactly what the code means — no quoting
  artefact, no truncation, no “it ran but meant something else”. These are the
  silent-failure cases the corpus exists for. **Confirmed clean, 2026-08-27** —
  all 14 fixture files round-tripped byte for byte, no quoting/truncation
  defects. A stray "The SAS System …" banner line did bleed into 4 of the 14
  runs' output — the same root cause as "Large output stays clean" below, not
  a separate corpus defect; tracked once there, not twice.
  `utf8-bom.py` was added with slice 5d-ii (2026-09-02) and is **not** covered
  by the 2026-08-27 run; its live upload + `infile=` behaviour is separately
  established by Finding 77 (`docs/phases/phase-5.md`), and it should be folded
  into the next full corpus run here.
- [x] **(live) Run File starts a fresh namespace each time** — **Run File** a
  file that is just `a = 41`; then **Run File** a file that is just `print(a)`.
  **Expect:** `NameError` — every _Run File_ runs with `freshNamespace: true`.
- [x] **(live) Run Selection builds on state like a cell** — select `b = 41` →
  **Run Selection**; then select `print(b + 1)` → **Run Selection**.
  **Expect:** `42` — a selection runs against the live namespace
  (`freshNamespace: false`).
- [x] **(live) Reset Python State really restarts the interpreter** — after the
  previous item, run **Reset Python State**, then select `print(b)` → **Run
  Selection**.
  **Expect:** `NameError`.
- [x] **(live) Failure is detected, not swallowed** — run a file whose top level
  raises (`raise RuntimeError("nope")`).
  **Expect:** reported as failed, not “Finished”; the error text is in the log.
  The interpreter banner and `>>>` markers may appear here too — same known
  `PROC PYTHON` behaviour as the "Hello world streams clean" item above, not
  error-path-specific (the earlier "only observed on the error path" reading
  was wrong — see the 5d-iii refinement and Finding 93). **Closed
  2026-09-09:** the redundant-echo half was fixed in **5d-iii**; the
  transcript-noise half is settled by **Finding 93** — no `PROC PYTHON` option
  suppresses it, accepted and documented rather than filtered. Finding 74 is
  fully closed.
- [x] **(live) Large output stays clean** — run `for i in range(5000): print(i)`.
  **Expect:** all 5000 lines, in order, no pagination header bleeding into the
  stream. **Failed, 2026-08-27** — the "The SAS System …" page-break banner
  bled into the stream roughly every 58 lines. Root cause: `isNoiseLine`
  (`src/backend/logFilter.ts`) doesn't exclude `title`-typed log lines, and
  `PAGESIZE=MAX` still isn't sent at session creation — both already named as
  an open gap in `logFilter.ts`'s own doc comment (Finding 63) but never
  picked up as a fix. Tracked in Phase 3's **3f** slice.
- [x] **(live) Busy session refuses a second submission** — start the long run
  below, then try **Run File** again.
  **Expect:** refused with an “already running” message.
- [x] **(live) Cancel, both ways** — run:

  ```python
  import time
  print("start")
  time.sleep(60)
  print("done")
  ```

  Cancel from the progress notification's **Cancel** button; repeat and cancel
  via the **Cancel** command in the palette.
  **Expect:** both stop the run; `done` never prints. The notification really
  does show a Cancel button (Notification-location progress, not Window). The
  output channel's cancellation line reads **"Cancelled. If a single step was
  already running, SAS Viya may keep executing it until that step finishes on
  its own."** (reworded in phase 4c per Finding 76), and **no error
  notification** appears — a clean cancel means the server accepted the
  `If-Match`'d state `PUT` rather than the `428` a bare request drew before
  the 4c fix (Finding 75).
  **Re-verified 2026-09-01** against `verde` with a `.vsix` from
  `phase-4c-traceback-and-cancel-fix`: both cancel paths as above, reworded
  message shown, no error toast. A run submitted ~15 s into the `sleep`
  immediately after a cancel completed cleanly ~30–40 s later — the cancelled
  step ran out its natural duration before the session freed (Finding 76),
  with no corruption and no reconnect needed.

## 7. Tracebacks — phase 3c-ii

- [x] **(live) Wrapper frames are dropped, yours are kept** — run:

  ```python
  def inner():
      raise ValueError("boom")

  def outer():
      inner()

  outer()
  ```

  **Expect:** a traceback showing `outer` then `inner` and `ValueError: boom`.
  The harness's leading `<stdin>` wrapper frames at the top are gone.
- [x] **(live) Deep / recursive stacks survive** — run a bare recursion, no
  test framework:

  ```python
  def recurse(n):
      return recurse(n + 1)

  recurse(0)
  ```

  **Expect:** a `RecursionError` traceback with the repeated `recurse`
  frames all present — only the _leading_ contiguous run of harness frames
  is removed — and the session still alive for the next submission.
  **Passed 2026-08-31** against a `.vsix` from
  `phase-3f-manual-test-regressions`: a clean
  `RecursionError: maximum recursion depth exceeded`, "Finished with an
  error.", session unharmed. The stream showed the `<stdin>` wrapper
  frame, then `<string>` line 4 (`recurse(0)`), then ~998 `recurse`
  frames collapsed by Python's own `[Previous line repeated 995 more
  times]` — repeats preserved, nothing over-trimmed. (Confirm the leading
  `<stdin>` frame is dropped in the **Result panel**'s structured
  traceback, which is where 3c-ii does that — the output-channel stream
  keeps it.)

  *History.* Both earlier runs used a 5-case `unittest` script
  (`test_deep_stack_trim.py`). **2026-08-27 and again 2026-08-30, same
  script:** all 5 frame-trimming assertions passed, then the Python
  subprocess crashed ("trying to use more memory than the container is
  configured to allow") immediately after. That crash is **not** recursion
  depth — the script caps `sys.setrecursionlimit(200)` — and did not
  reproduce with the minimal script above, so it was the test harness
  itself (`unittest.main()` calling `sys.exit()` inside `PROC PYTHON`,
  five `setUp` calls re-running the capture), not this item's behaviour.
  Resolved. **Separate observation from this run:** the failing run's
  stream also carried the Python interpreter banner and `>>>` prompt
  markers, which §6 says should never appear — split out as its own
  open item in Phase 3's **3f** slice, not a blocker for this box.
  **Update (5d-iii, 2026-09-02):** the redundant traceback-tail echo this
  run also showed is fixed — verified live, see the dedicated row below. The
  banner/`>>>` transcript noise stays open as a live-Viya probe follow-up
  (see §6's "Failure is detected" note and `phase-5.md`'s Runbook item 3).
- [x] **(live) Traceback is not echoed or mangled after the outcome — phase 5d-iii** —
  re-run the bare recursion from the row above; it is the shape that first
  showed this (Finding 74).

  ```python
  def recurse(n):
      return recurse(n + 1)

  recurse(0)
  ```

  **Expect — output channel:** the raw traceback streams once while the run
  executes; then `Finished with an error.` on its own line with **nothing after
  it**. The `RecursionError: maximum recursion depth exceeded` line is **not**
  repeated below the outcome. (Before 5d-iii it was printed a second time, with
  a stray `>>>` glued onto its end.)

  **Expect — Problems panel and Result panel:** the exception message ends at
  `RecursionError: maximum recursion depth exceeded` with **no trailing `>>>`
  or `...`**. (It may still be _prefixed_ by `[Previous line repeated N more
  times]` — that is pre-existing `parseTraceback` behaviour, not this slice,
  and is genuine traceback content rather than a prompt marker.)

  **Then confirm the lines that must still print** (they never streamed, so the
  dedupe must leave them alone):

  - `import nosuchpkg` → after `Finished with an error.` the output channel
    still shows the `ModuleNotFoundError: …` line **with** the
    `Run "Python on Viya: Show Environment" …` sentence appended. One repeat of
    the exception tail here is expected and accepted.
  - Any SAS-side failure with no Python traceback (`SYSCC` non-zero and not
    `1012` — e.g. `PROC PYTHON` unavailable, or a dead session): its
    `SYSERRORTEXT` message still prints on the line after `Finished with an
    error.`
  - A traceback header with frames but no exception line (hard to force by
    hand; unit-covered): the output channel still shows a final
    `an unhandled Python exception` line.

  **Not this box:** the interpreter banner (`Python 3.x … / Type "help" …`) and
  bare `>>>` markers still appearing in the *live transcript* of a failing run
  are Finding 74's other half, deliberately deferred to a live-Viya probe
  (`phase-5.md` Runbook item 3). Note whether you see them; do not fail this
  item for it.

  **Verified live 2026-09-02** against `verde` with a `.vsix` from
  `phase-5d-iii-finding-74` (PR #92). Ten runs — five scripts × **Run
  Selection** and **Run File**:

  1. bare recursion → output channel ends at `Finished with an error.`;
     structured message `[Previous line repeated 995 more times]
     RecursionError: maximum recursion depth exceeded` — no trailing `>>>`,
     no third copy in an outcome line.
  2. `raise ValueError("boom")` → full dedup: `Finished with an error.` on
     its own, structured message `ValueError: boom`, **no outcome bullet**.
  3. `import nosuchpkg` → the superset case: after `Finished with an
     error.` the channel still prints `ModuleNotFoundError: No module named
     'nosuchpkg' Run "Python on Viya: Show Environment" …`; the structured
     message is Python's own text with no pointer and no `>>>`.
  4. `print(">>> …")` / `print("...")` then `raise` → no over-reach: both
     `print` lines survive verbatim in the stream, message is `RuntimeError:
     done` only.
  5. figure written then `raise` → rich-output capture still runs on the
     failure path; panel shows raw log + structured traceback + PNG +
     `Finished with an error.` with no outcome bullet.
  6. successful run (`print(f"the answer is {x}")`) → `Finished.` alone; no
     traceback block; panel does not reveal for text-only.

  Run Selection and Run File matched on every case. The
  synthesized-fallback / SAS-side-`SYSERRORTEXT` sub-cases were left to unit
  and integration coverage (not hand-forceable). **Sub-finding (a) noise**
  (banner on Run File, `>>>` on every run) was present throughout, as
  expected — see §6's "Hello world streams clean" note for the refined
  characterisation.
- [x] **(live) `ModuleNotFoundError` points at Show Environment** — run
  `import polars` (or any absent package).
  **Expect:** a `ModuleNotFoundError` traceback whose diagnostic message (the
  line after "Finished with an error." in the output channel) has one
  sentence appended: `Run "Python on Viya: Show Environment" to see what is
  installed on this connection.` The structured traceback itself (Result
  panel, once 4d wires it) keeps Python's own text unchanged.
  **Implemented in phase 4c** (`src/backend/tracebackDiagnostics.ts`'s
  `withModuleNotFoundGuidance`), unit-covered, and **verified live
  2026-09-01** against `verde` with a branch `.vsix` — the appended sentence
  appears on the diagnostic exactly as above.
- [x] **(live) A failed run lands in the Problems panel — phase 4d** — run a
  file whose last line is `c = 1 / 0`.
  **Expect:** after "Finished with an error.", the **Problems** panel
  (View → Problems) shows exactly one entry for this file — `Error`, source
  "Python on Viya", its message the same `ZeroDivisionError: division by
  zero` line the output channel shows — positioned on the `1 / 0` line.
  Expanding it walks the rest of the call stack (`relatedInformation`).
  Re-run the file with the error fixed → the Problems entry clears at the
  **start** of the run. Run Selection starting partway down the file → the
  entry still lands on the true editor line (`lineOffset` is added). A
  SAS-side failure with no Python traceback (e.g. `PROC PYTHON` not licensed)
  produces **no** Problems entry — only the output-channel message.
  Implemented in phase 4d (`src/run/diagnostics.ts`); **verified live
  2026-09-02** against `verde` with a branch `.vsix` — the entry lands on
  the `1 / 0` line, clears on a clean re-run, and follows the selection's
  `lineOffset`.
- [x] **(live) A stranded Problems entry clears on the lifecycle events, not
  only a re-run — phase 5d-iv** — this is about the **Problems** panel
  (**View → Problems**, `Ctrl+Shift+M`), not the Result panel webview, which
  is untouched throughout. Produce a Problems entry as in the row above (run a
  file whose last line is `c = 1 / 0`), confirm the one entry for that file is
  showing, then — one at a time, re-running for a fresh entry before each:
  **(a)** close that file's editor tab (save first if it is dirty) → the
  Problems entry disappears; reopen the file → still gone (no run has
  happened). **(b)** run **Python on Viya: Sign Out** → entry gone. **(c)**
  **Select Run Target → Local Python** → entry gone; switch the target back to
  the Viya profile → still gone. With two profiles configured, switching from
  one Viya profile to another (staying on Viya) leaves the entry in place.
  Implemented in 5d-iv (`src/run/commands.ts` wiring, `RunDiagnostics.clearAll`,
  and `ViyaAuthenticationProvider.onDidSignOut` for (b)). **Verified live
  2026-09-03** against `verde` with a branch `.vsix` (after a window reload) —
  (a), (b) and (c) all clear the entry, the reopen/switch-back cases leave it
  gone, and the viya→viya switch leaves it in place.

## 8. Rich output: matplotlib and pandas — phases 3c-i, 3d-ii

Capture is a before/after diff of the session's working directory
([ADR-0019](../adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md)) —
your script must actually write a `.png` or `.html` file; there is no implicit
`savefig`. Output lands in the Result panel, a single CSP-locked webview
([ADR-0021](../adr/0021-result-panel-webview.md)).

- [x] **(live) matplotlib figure renders in the panel** — run:

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
- [x] **(live) pandas HTML renders as a real table** — run:

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
- [x] **(live) Multiple figures, ordered and numbered** — a loop writing
  `fig_0.png`, `fig_1.png`, `fig_2.png`.
  **Expect:** all three in the panel, in filename order, after the text output,
  numbered.
- [x] **(live) Panel is a singleton** — run another rich output with the panel
  already open.
  **Expect:** the same panel is reused, never a second one — meaning its
  content is **replaced**, not appended to. Confirmed 2026-08-27: re-running a
  rich output clears the existing panel and writes the new one in its place;
  this is the intended behavior, not a bug.
- [x] **(live) Reveal policy** — run a text-only script; then one producing an
  image; then a run that only fails.
  **Expect:** text-only (fully visible in the output channel) does **not** pop
  the panel; an image / HTML / structured traceback does; an outcome-only or
  failure-only run never opens it.
- [x] **(live) Re-reveal for a later run** — leave the panel open but click back
  into the editor so it is unfocused; run another matplotlib script.
  **Expect:** the panel comes back to the front — not only for the run that
  first created it. _(Regression: this was a fixed bug.)_
- [x] **(live) Oversize output is skipped, not fatal** — write a `.png` bigger
  than 10 MiB without asking the session for gigabytes of render buffer to
  do it:

  ```python
  import matplotlib
  matplotlib.use("Agg")
  import matplotlib.pyplot as plt
  import numpy as np

  fig, ax = plt.subplots(figsize=(20, 20))
  ax.imshow(np.random.rand(3000, 3000))
  fig.savefig("oversize.png", dpi=200)
  print("wrote an oversize figure")
  ```

  **Expect:** the run finishes and its stdout is shown; a “could not
  retrieve rich output file …” note appears in place of the figure,
  naming the file and the size cap; the session stays alive and the next
  selection runs normally. **Passed 2026-08-31** against a `.vsix` from
  `phase-3f-manual-test-regressions`: the run returned
  `[could not retrieve rich output file "oversize.png": it is larger than
  the 10485760-byte capture limit]` in place of the figure, and a
  following `import matplotlib` selection ran normally on the same
  session — the skip path (ADR-0019 point 8) works as designed once the
  script does not OOM the container first.

  *History.* The 2026-08-27 pass skipped this item — the wording then gave
  no way to make a file this large. The 2026-08-30 pass ran it against a
  **different** script (`figsize=(40, 40)`,
  `imshow(np.random.rand(4000, 4000, 3))`, `dpi=300`) and it did not skip:
  the run failed with an HTTP 500 on the job-log poll and the compute
  session was gone afterward (Finding 73). Root cause is that script, not
  the cap — it allocates ~384 MB for the array and renders a ~1.7 GB
  canvas, so the container is out of memory inside `savefig` before any
  file exists to skip. ADR-0019's cap guards the *transfer* of a written
  file, never a script's own memory use during generation — see that
  ADR's 2026-08-30 amendment. The script above is sized to exercise the
  skip path the cap actually owns.

  *Separate known limitation, tracked in Phase 3's **3f** slice:* a script
  whose figure generation exhausts the session container kills the
  session mid-run, surfacing as a job-log 500 then a session 404. That is
  an out-of-memory kill like any other, outside this item's scope; a
  friendlier message for it is an open question, not a decided fix.
- [x] **(live) Cancelled run captures nothing** — a script that writes a figure
  then `time.sleep(60)`; cancel it.
  **Expect:** no image captured — the after-snapshot is skipped on a cancelled
  outcome. Confirmed 2026-08-27. **Follow-up raised, not a failure of this
  item:** by design (ADR-0019), a cancelled run never reads back *or deletes*
  whatever partial file was written before cancellation, so it can be
  orphaned in the session's working directory. Tracked as a documentation
  item in Phase 3's **3f** slice — ADR-0019 should say this explicitly rather
  than leaving it implicit.
- [x] **(known gap) Reload loses the panel content** — with the panel populated,
  reload the window.
  **Expect:** the content is gone. No `WebviewPanelSerializer` yet — same as the
  output channel losing scrollback.
- [x] **(live) Accessibility and theming** — tab through the panel; switch VS
  Code between light, dark, and a high-contrast theme.
  **Expect:** image alt text; the table is a navigable table; a traceback is a
  heading, a message, and a genuine ordered list of frames. Legible in every
  theme; loads nothing from the network (CSP-locked).
- [x] **(live) Traceback frames jump to the editor — phase 4d** — run the
  `outer()`/`inner()` script from §7 and let it raise, so the Result panel
  shows its structured traceback.
  **Expect:** each frame from your own file (`<string>`) is underlined and
  focusable — click it, or Tab to it and press Enter/Space, and the editor
  reveals that line (adding the `lineOffset` for a Run Selection). A frame
  with an absolute library path is plain text, not interactive. No CSP
  change — the panel still loads nothing from the network. **Verified live
  2026-09-02** against `verde` with a branch `.vsix` — clicking a `<string>`
  frame reveals it in the editor column (not over the panel); a library
  frame is not clickable. **Phase 5d-iv** adds a per-run token to the
  `revealFrame` message so a click delayed past the start of a later run is
  dropped, not resolved against the new run's traceback — a race that needs
  the host event loop stalled across a whole run to hit, so it is
  unit/integration-covered (`result-panel.test.ts`) rather than a hand-run
  step here.

## 9. Environment and package list — phase 3e

A slow answer that changes rarely — probed on demand, cached per profile in
global state, refreshed explicitly.

- [x] **(live) Show Environment opens the list** — run **Show Environment** (or
  click the second status-bar item, right of the profile).
  **Expect:** a read-only virtual document: interpreter version and path, then
  installed distributions with versions (from `importlib.metadata`, not `pip`).
  Ctrl/Cmd-F searches it; it splits alongside code.
- [x] **(live) Refresh updates an open tab in place** — with the document open,
  run **Refresh Environment Info**.
  **Expect:** it re-probes and the open tab shows the fresh answer (no new tab).
- [x] **(live) Per-profile cache** — Show Environment on profile A; switch to B
  and Show Environment (it probes); switch back to A.
  **Expect:** A's list returns instantly from cache — keyed on profile id.
- [x] **(live) Cache persists across reload** — reload the window, then Show
  Environment.
  **Expect:** still instant — the cache is `globalState`. A fresh window with a
  cached answer should not connect just to render it.
- [x] **(live) Probing has no side effects on your namespace** — run selection
  `z = 1`; force a **Show Environment** refresh; run selection `print(z)`.
  **Expect:** `1` — the probe neither restarts the interpreter nor leaves
  `sys` / `json` / `importlib` bound in your namespace.
- [x] **(live) Shares the serial contract** — trigger **Show Environment** while
  a run is in flight.
  **Expect:** refused, as a second run would be — there is just nothing to
  cancel it with.
- [x] **(live) A big list renders whole** — on a stock Viya 4 the list can run
  to a few hundred entries (~250+). To actually see this: run **Show
  Environment** against a profile with `numpy`/`pandas`/`matplotlib`/`scipy`
  installed (each pulls in a long dependency chain) — `verde` measured 259
  packages during Phase 3e's own live probe, a realistic stand-in for "a few
  hundred."
  **Expect:** the whole list renders; a distribution with broken `METADATA` is
  skipped rather than blanking or crashing the probe. *(Not run 2026-08-27 —
  the previous wording gave no concrete way to reach "a big list"; use the
  profile/package guidance above.)*

## 10. SAS Libraries — browsing your session (phase 7a)

A second, independent tree in the same activity-bar container Phase 6 added,
reading the *active compute session's* own libraries and tables
([ADR-0027](../adr/0027-library-adapter-shape.md)) — unlike SAS Content
(Phase 6), which reads a deployment-wide Folders/Files service and needs no
session at all. **Not yet run** — this section and §11 are new for Phase
7a/7b and have no prior pass to compare against; every box below is a first
assertion, not a re-check.

**Pre-work:** a Viya connection, the same one §4 sets up — sign in and
**Connect to SAS Viya** first, so a compute session actually exists. You do
not need any table of your own: **SASHELP**, a system library, ships with
every Viya deployment and is what every example below uses. If your
deployment happens to lack it, substitute any library/table you can see.

- [x] **The view exists and reflects connection state** — open the **Python
  on Viya** icon in the Activity Bar.
  **Expect:** two views stacked in the same container — **SAS Content**
  (Phase 6) above, **SAS Libraries** below. Before any profile is configured,
  SAS Libraries shows "Add a SAS Viya connection profile to browse
  libraries." with a clickable **Add Connection Profile** link. Signed out
  with a profile configured, it instead reads "Sign in to SAS Viya to browse
  libraries." Signed in but not connected, it reads "Connect to SAS Viya to
  browse libraries in your session." Each message's link does what it says.
- [x] **Connecting populates the tree** — with a profile signed in, run
  **Connect to SAS Viya** (§4).
  **Expect:** SAS Libraries now lists at least **SASHELP** and **WORK**, each
  with a database icon and a collapsed expand chevron — no welcome text
  remains.
- [x] **Expanding a library lists its tables** — click the chevron next to
  **SASHELP** to expand it.
  **Expect:** a list of tables appears, each with a different icon than the
  library had (no database icon, no expand chevron — a table is always a
  leaf this phase). SASHELP alone can hold several hundred tables on a stock
  deployment; if the list is long, that is expected, not a bug.
- [x] **Refresh reloads the tree** — click the refresh icon in the SAS
  Libraries title bar (hover the view's header if you don't see it), or run
  **Refresh SAS Libraries** from the Command Palette.
  **Expect:** the tree reloads. If nothing changed on the server, the visible
  list looks the same — that is a pass, not a no-op failure.
- [x] **The tree follows connection changes on its own** — with SAS
  Libraries populated, run **Disconnect from SAS Viya**, then **Connect to
  SAS Viya** again (optionally to a different profile, if you have two).
  **Expect:** the tree updates by itself — empty (welcome text) right after
  Disconnect, repopulated after Connect — without you pressing Refresh.
- [x] **A busy session refuses browsing instead of hanging** — start a
  long-running selection first: open a `.py` file, type `import time;
  time.sleep(30)`, select it, and **Run Selection** (§6 has the mechanics if
  this is unfamiliar). While that run is still going, run **Refresh SAS
  Libraries**, then try expanding a library you have not yet expanded this
  session.
  **Expect:** nothing new appears, and neither action hangs for the run's
  30 seconds — it returns immediately with nothing changed. Open **Show
  Log**: you should see a line reading `SAS Libraries: the compute session is
  running Python and cannot be browsed right now`. Once the run finishes,
  repeat the refresh/expand and confirm it now works normally.
- [x] **Disconnecting empties the tree cleanly** — run **Disconnect from SAS
  Viya**.
  **Expect:** SAS Libraries returns to its "Connect to SAS Viya…" welcome
  text; no stale library or table entries are left showing.

## 11. Data viewer webview (phase 7b)

Clicking a table in SAS Libraries (§10) opens it in a scrollable grid — a
second webview panel this project ships, built with React and
`ag-grid-community` rather than hand-rolled DOM
([ADR-0028](../adr/0028-data-viewer-is-react-and-ag-grid.md)), reading
through `LibraryAdapter.openTable`/`getColumns`/`getRows`
(`docs/phases/phase-7.md`). **Not yet run** — no prior pass exists for this
section either; see §10's own note.

**Pre-work:** the same live connection as §10 — SAS Libraries populated,
**SASHELP** expanded. This section's running example is **SASHELP.CLASS**: a
small, standard table (19 rows; columns Name and Sex as text, Age, Height and
Weight as numbers) that every live probe and automated test in this phase
already uses, so its exact shape is known ahead of time. If you'd like to
also see a grid actually page (§11's fourth box), pick a second, larger
SASHELP table too — anything with more than a couple hundred rows will do.

- [x] **Clicking a table opens it** — expand **SASHELP**, then click
  **CLASS** (a plain click, the same as opening a file — not a right-click
  action).
  **Expect:** a new tab opens in the editor area titled `SASHELP.CLASS`.
  Briefly nothing is visible, then a grid appears with five columns — Name,
  Sex, Age, Height, Weight — populated with data, 19 rows in total.
- [x] **The right-click menu does the same thing** — right-click a
  *different* table and choose **Open Table**.
  **Expect:** identical result to the box above, just reached from the
  context menu instead of a click.
- [x] **Numbers are right-aligned, text is not** — look at the open
  **SASHELP.CLASS** grid.
  **Expect:** the Age, Height and Weight columns are right-aligned; Name and
  Sex are left-aligned — the ordinary spreadsheet convention, and something
  this phase's own review added (the column's type was being carried across
  the wire from the start, but nothing actually read it to align anything
  until caught in review).
- [x] **Every row is really there** — scroll the **SASHELP.CLASS** grid all
  the way to the bottom.
  **Expect:** exactly 19 rows, no gaps, no blank rows, nothing repeated. The
  scrollbar should already be sized as though the grid knows the true total
  from the start, not growing in size as you scroll further down.
- [x] **A larger table actually pages as you scroll (slow)** — open your
  second, larger table (see this section's pre-work) and scroll down steadily
  past the first couple hundred rows.
  **Expect:** new rows keep appearing smoothly as you reach the bottom of
  what's loaded so far; there is a brief pause the first time each new block
  loads, but no permanent stop partway through, and no error.
- [x] **Opening an already-open table reveals it, not a duplicate** — with
  **SASHELP.CLASS** already open, click **CLASS** again from the tree.
  **Expect:** VS Code switches focus to the existing tab; no second
  `SASHELP.CLASS` tab is created.
- [x] **Two different tables stay independent** — open a second, different
  table alongside **SASHELP.CLASS**.
  **Expect:** two separate tabs, each showing its own data; closing one
  leaves the other exactly as it was, still scrolled where you left it.
- [x] **A busy session shows the reason in the panel, not a blank grid** —
  start the same `time.sleep(30)` selection as §10's busy-session box, and
  while it runs, open a table you have **not** already opened this session.
  **Expect:** the tab opens, but instead of a grid you see a short message
  explaining that the session is busy running Python and cannot be browsed —
  in the panel itself, not only in the log.
- [x] **Closing a panel while it is still loading does not error** — open a
  table you have not opened before, and close its tab immediately (within
  about a second, before the grid has had time to appear).
  **Expect:** no error notification, nothing alarming in **Show Log**; open a
  different table afterward to confirm the extension is still working
  normally.
- [x] **Switching away and back does not scramble the data** — with a table
  open and scrolled partway down, click into a code editor tab (so the panel
  is hidden), then click straight back to the table's own tab quickly — within
  a second or two, ideally while a scroll-triggered fetch might still be in
  flight.
  **Expect:** the grid visibly reloads (a brief flash/refetch is expected —
  the panel does not preserve its state while hidden) and then shows the
  correct rows for wherever you land — never rows that belong to a different
  scroll position. This is the hand-run version of a `requestId`-collision
  defect found and fixed in code review; rows that don't match where you
  scrolled to is exactly that regression coming back.
- [x] **Legible in every theme** — with a table open, switch VS Code between
  a light theme, a dark theme, and a high-contrast theme (Command Palette →
  **Preferences: Color Theme**).
  **Expect:** text and grid lines stay readable in all three, and nothing in
  the grid (column headers, the loading indicator, resize handles) shows as a
  visibly broken/missing icon — this panel's Content-Security-Policy
  deliberately allows no image loading at all, on the prediction that
  `ag-grid` needs none; a broken icon here means that prediction was wrong,
  which is itself worth reporting, not just a cosmetic nit.
- [x] **(known gap, closed by phase 7c-i) No sort or filter yet in this
  slice** — look for either on an open table.
  **Expect (7b):** neither exists — Phase 7c, not this slice. See §12 for
  7c-i's own pass, now that sort and filter exist. CSV export and a table
  properties view remain Phase 7c-ii/iii, still absent as of this pass.

## 12. Sort and filter in the data viewer (phase 7c-i)

Adds column sort (click a header) and a free-text filter box above the grid
to the data viewer §11 already covers — both server-side
([ADR-0029](../adr/0029-sort-view-lifecycle.md)), neither client-side.
**Sean's own first pass ran 2026-09-10** and found three real bugs, all now
fixed on the `phase-7c-i-sort-filter` branch, not yet re-verified against a
real panel: a sort or filter was silently lost switching away from the
table's tab and back (`retainContextWhenHidden: false` reloads the webview
document on every hide/show, and the freshly mounted grid had no way to tell
the host it should keep whatever sort/filter the previous document had — see
the two new rows below, added for this), and an invalid filter showed a
blank grid with no error or warning anywhere, not even the log (the host
already computed a real, specific message — Finding 7.18 — but
`dataViewerEntry.tsx`'s own datasource was discarding it — see the
now-unchecked row below). Every other row below was validated clean by that
same first pass and stays checked: the fix for the three bugs above touched
no code path any of them exercises. See `phase-7.md`'s 7c-i Runbook entry
for the full account.

**Pre-work:** the same live connection and open **SASHELP.CLASS** table as
§11.

- [x] **Clicking a column header sorts the grid** — with **SASHELP.CLASS**
  open, click the **Age** column header.
  **Expect:** a brief pause, then the grid re-renders sorted by Age
  (ascending — an arrow or similar indicator appears in the header). Click
  the same header again for descending.
- [x] **Sorting scrolls to the top** — with the grid scrolled partway down,
  click a different column's header to change the sort.
  **Expect:** the grid returns to the top and shows the newly sorted rows
  from the start, not a stale scroll position over now-reordered data.
- [x] **The filter box applies a SAS `WHERE` clause** — type
  `Sex='F'` (including the quotes) into the filter box above the grid and
  press Enter.
  **Expect:** the grid reloads showing only the 9 female students from
  **SASHELP.CLASS**; the row count (if visible) drops accordingly.
- [x] **Sort and filter combine** — with the filter from the box above still
  applied, click the **Age** column header.
  **Expect:** the grid shows only the filtered (female) rows, now also
  sorted by Age — not all 19 rows, and not the filter silently dropped.
- [x] **Clearing the filter box restores every row** — select all the text in
  the filter box, delete it, and press Enter.
  **Expect:** all 19 rows return (still sorted, if a sort is still active).
- [x] **An invalid filter expression shows a real error, not a blank grid** —
  type `NoSuchColumn=1` into the filter box and press Enter.
  **Expect:** the grid shows an error (in the panel, not just the log) naming
  the actual problem (a variable that does not exist on the table) rather
  than a generic failure or a silently empty grid.
  **First pass, 2026-09-10 (Sean): failed** — a blank grid, no error or
  warning anywhere, nothing in the log. The host was already computing the
  real SAS parser message (Finding 7.18) but `dataViewerEntry.tsx`'s own
  datasource discarded it on a failed fetch; fixed by rendering it in a small
  banner above the grid, and by adding a `log?.warn` in `dataViewerPanel.ts`
  for both row-fetch failure paths (there was none before, for either).
- [x] **A sort survives switching to a different tab and back** — with the
  grid sorted by **Age** (first item above), switch to a different editor
  tab, then switch back to this table's tab.
  **Expect:** the grid still shows the sort indicator and the Age-sorted
  rows, not a reset to the table's natural row order.
  **First pass, 2026-09-10 (Sean): failed** — the sort was silently lost.
  `retainContextWhenHidden: false` reloads the webview document on every
  hide/show, and the freshly mounted grid had no memory of the previous
  document's sort; its own first row request read as "no sort", which this
  panel's own state machine takes as an instruction to discard the
  still-wanted server-side view. Fixed: the host now replays its current
  sort/filter, not the state from when the table was first opened, on every
  `"ready"` handshake (`InitMessage.initialSort`/`initialFilter`,
  `dataViewerModel.ts`).
- [x] **A filter survives switching to a different tab and back** — with the
  filter box showing `Sex='F'` (per the filter-box item above), switch to a
  different editor tab, then switch back.
  **Expect:** the filter box still shows `Sex='F'` and the grid still shows
  only the filtered rows, not a reset to all 19 unfiltered rows.
  **First pass, 2026-09-10 (Sean): failed**, for the same reason and with the
  same fix as the sort row immediately above.
- [x] **A large table still pages correctly while sorted** — open your
  second, larger table (§11's pre-work) and sort it by a column, then scroll
  to the bottom.
  **Expect:** new rows keep appearing as you scroll, exactly as an unsorted
  large table already does (§11) — sorting does not break paging, and the
  final row count (if the grid shows one) is not negative or obviously wrong
  (a real risk this feature's own design flagged: a freshly created sort view
  reports an internal placeholder row count that must never reach the UI).
- [x] **Closing the panel while sorted does not error** — with a sort active,
  close the table's tab.
  **Expect:** no error notification; open a different table afterward to
  confirm the extension still works normally. (This exercises a background
  cleanup of the temporary sort view the panel created — nothing about that
  should be visible from the UI side either way.)
- [x] **The filter box and grid icons are legible** — with a table open,
  switch between a light theme, a dark theme, and a high-contrast theme.
  **Expect:** the filter box's placeholder text and any sort-direction
  indicator in a column header are both legible and not shown as a
  broken/missing icon in any of the three themes.

## 13. Table properties (phase 7c-ii)

Adds a **Table Properties** command to a table's context menu in the SAS
Libraries view — a fully static panel (no scripts at all; its "Properties"/
"Columns" tab toggle is pure CSS, no message loop) showing the table's size,
engine, encoding and timestamp details ([Finding 7.19](../phases/phase-7.md))
and its full column list. **Sean's own first pass, 2026-09-10, found one real
bug**: both panes rendered blank regardless of which tab was selected (the
CSS-only tab toggle's sibling selector could never match either pane — see the
"Properties tab shows real values" row below for the full account). Root-caused
and fixed on `fix/7c-ii-table-properties-blank-panes`, then **re-verified live,
2026-09-11 (Sean, against `verde`)**, along with every other row this section's
first pass could not reach while the panes were blank — every row below is
now checked clean.

**Pre-work:** the same live connection as §10, with **SASHELP.CLASS** visible
in the tree.

- [x] **Table Properties opens a panel with two tabs** — right-click
  **SASHELP.CLASS** and choose **Table Properties**.
  **Expect:** a new panel opens, titled with the table's `libref.name`,
  showing a **Properties** tab (selected by default) and a **Columns** tab.
- [x] **The Properties tab shows real values** — with the Properties tab
  selected.
  **Expect:** Name **CLASS**, Library **SASHELP**, Type **DATA**, Label
  **Student Data**, Engine **V9**; Row Count **19**, Column Count **5**;
  Created/Modified show a real date/time (not a raw number), Compression
  Routine **NO**, Encoding **us-ascii ASCII (ANSI)**.
  **First pass, 2026-09-10 (Sean): failed**, tab comes up with two sub tabs
  'properties' and 'columns' but it's all blank.
  **Root-caused and fixed** on `fix/7c-ii-table-properties-blank-panes`: the
  two radio inputs driving the CSS-only tab toggle were nested one level
  deeper (inside their own wrapper `<div>`) than the two panes they were
  meant to reveal, so `panelHead`'s `:checked ~ #pane-*` general-sibling rule
  could never match either pane and both stayed at their `display: none`
  default regardless of which tab was selected — a static-HTML/CSS defect,
  not a data-mapping one. Fixed in `src/data/tablePropertiesPanel.ts`
  (flattened sibling structure); confirmed live in a real browser
  (before/after) that the broken structure reproduces this exact symptom and
  the fix resolves it, and pinned with a new integration test.
  **Re-verified live, 2026-09-11 (Sean), against `verde` with a `.vsix` built
  from `fix/7c-ii-table-properties-blank-panes`:** every field matches —
  Name **CLASS**, Library **SASHELP**, Type **DATA**, Label **Student Data**,
  Engine **V9**, Row Count **19**, Column Count **5**, Created/Modified as
  real dates, Compression Routine **NO**, Encoding **us-ascii ASCII (ANSI)**.
  See `phase-7.md`'s 7c-ii Runbook entry (post-merge fix) for the full
  account.
- [x] **Clicking the Columns tab switches panes, with no flash or reload** —
  click the **Columns** tab, then click back to **Properties**.
  **Expect:** the visible pane switches instantly (this is pure CSS, not a
  script) — Name/Sex/Age/Height/Weight with their types (CHAR/CHAR/FLOAT/
  FLOAT/FLOAT), lengths, and no error.
- [x] **Choosing Table Properties again reveals the same panel** — with the
  panel from the item above still open, right-click **SASHELP.CLASS** and
  choose **Table Properties** again.
  **Expect:** the existing panel is revealed/focused, not a second one opened.
- [x] **The panel is legible in light, dark, and high-contrast themes** —
  switch VS Code's color theme with the panel open.
  **Expect:** text, table borders, and the tab underline all remain legible in
  all three; nothing renders as an unstyled white box.
- [x] **A table properties panel opened while the session is busy shows a
  clear message, not a blank panel** — start a long-running Python job, then
  choose **Table Properties** on any table before it finishes.
  **Expect:** the panel shows a real, readable message (not a blank page)
  explaining the session is busy.

## 14. Trust, enablement and the rest

- [x] **Untrusted workspace posture** — set the folder Restricted via
  **Workspaces: Manage Workspace Trust**.
  **Expect:** editing, syntax, and profile add/edit/delete still work;
  **Connect** and **Run File** are refused with a pointer to Manage Workspace
  Trust; `pythonOnViya.connectionProfiles` and `pythonOnViya.defaultProfile`
  show as restricted in Settings.
- [x] **Command enablement tracks state** — watch the palette across connect /
  disconnect / a run in flight.
  **Expect:** _Connect_ disappears once connected; _Disconnect_ only while
  connected; _Cancel_ only while a run is in flight. Confirmed for this
  ordinary connect/disconnect cycle. **Not covered by this item:** the
  sign-out/idle-reap/reload edge cases where Connect gets stuck hidden even
  though nothing is actually connected — see §3/§4 above and Phase 3's **3f**
  slice.
- [x] **(live) Sign out while connected** — with a live session, run **Sign
  Out**.
  **Expect:** the session is dropped; the next run re-authenticates cleanly.
  **Failed, 2026-08-27** — same defect as §3's Sign Out item: re-authentication
  never happens automatically. Tracked in Phase 3's **3f** slice; don't
  double-count against §3.
- [x] **Failures are diagnosable** — on any error path, open **Show Log**.
  **Expect:** it names the request, the deployment's own wording, a status code,
  and a correlation id. **Failed, 2026-08-27** — Python-level errors (a
  traceback) are diagnosable, but most *extension*-level failures ("could not
  be sent to SAS Viya…") produce nothing in the log at all. Root cause: three
  failure paths in `src/run/commands.ts` never call `log.*` before showing
  that message. Tracked in Phase 3's **3f** slice.

## 15. SAS Content — browsing, open/save, and mutations (phases 6a–6c, 6e)

A tree view over the deployment-wide Folders/Files service — this repo's
first activity-bar view container, first `FileSystemProvider`
(`sasContent:`), and first `TreeDragAndDropController`
([ADR-0025](../adr/0025-shared-wire-layer.md),
[ADR-0026](../adr/0026-content-adapter-shape.md)). Unlike SAS Libraries
(§10), it needs no compute session — signing in is enough. **First pass ran
2026-09-11 (Sean, live)** — no prior manual pass existed for any of Phase 6
before this. Every row through "Delete on an ordinary item recycles it
silently" passed clean.

Two things came out of that pass, both investigated at the Phase 6→7/8
housekeeping checkpoint rather than in this branch's own scope:

- The top-level-folder permanent-delete confirmation was recorded as
  blocked by a permissions limit. The Phase 6→7/8 housekeeping checkpoint
  later recorded that reason as wrong, reasoning from Sean's own admin
  access — **that correction was itself mistaken and is retracted.** Sean
  has since clarified: deleting a folder directly under SAS Content is
  restricted by a Viya deployment-level configuration set at install time,
  independent of the requesting account's own permissions — admin rights
  do not bypass it. The original finding was correct. **Deferred as a known
  gap** (row below) — it needs a deployment configured to allow this, not a
  retry on the current one.
- Drag-and-drop within the tree was completely non-functional. A real
  investigation found a plausible cause and shipped a fix for it
  ([ADR-0031](../adr/0031-content-folder-resource-uri.md); a folder tree
  item never carried a `resourceUri`) — but **a second live retest,
  2026-09-11, after the fix shipped, found drag-and-drop still completely
  non-functional, identical symptoms.** The `resourceUri` hypothesis is
  disproven as *the* cause (ADR-0031's own amendment); the change is kept
  regardless for its own smaller reasons, but drag-and-drop itself is now
  an accepted, deprioritised **(known gap)** — see `phase-11.md`. The four
  rows below that test drag variants stay unchecked; they cannot be
  exercised while the base gesture does not work at all. A right-click
  Cut/Paste alternative shipped alongside the fix attempt
  ([ADR-0032](../adr/0032-content-cut-paste.md)) and **is confirmed working,
  live, under its final command names** — this is now the only way to move
  an item in this tree, not merely the less ambiguous one.

**Pre-work:** a Viya connection signed in (§3) — no need to **Connect to
SAS Viya** first. Have write access to at least one folder you don't mind
creating, renaming, moving, and deleting test files/folders in.

- [x] **The view exists and reflects profile/auth state** — open the
  **Python on Viya** icon in the Activity Bar.
  **Expect:** **SAS Content** is the first view in the container. With no
  profile configured it reads "Add a SAS Viya connection profile to browse
  SAS Content." with a working **Add Connection Profile** link. With a
  profile configured but signed out, it reads "Sign in to SAS Viya to browse
  SAS Content." with a working **Sign In** link. There is no third
  "connect" state — signing in is enough, since this view never touches a
  compute session.
- [x] **Signing in populates the tree** — sign in.
  **Expect:** the view lists delegate rows for My Favorites, My Folder, SAS
  Content, and Recycle Bin (the exact names are whatever your deployment's
  Folders service returns), each with a chevron and no children loaded yet.
- [x] **Expanding a folder lists its contents, folders first** — expand SAS
  Content (or any folder with a mix of subfolders and files).
  **Expect:** subfolders are listed before files, and within each group,
  alphabetically, case-insensitively — this extension orders the listing
  itself rather than asking the server (ADR-0026).
- [x] **Refresh reloads the tree** — click the refresh icon in the SAS
  Content title bar, or run **Refresh SAS Content** from the Command
  Palette.
  **Expect:** the tree reloads; an unexpanded state stays unexpanded.
- [x] **Opening a file opens it for editing** — click a small text file
  (e.g. a `.py` or `.txt` file) in the tree.
  **Expect:** a new editor tab opens titled with the file's name, showing
  its real content; the tab is not read-only.
- [x] **Saving writes back to Viya** — with that file open, make a small
  edit and save (Ctrl/Cmd+S).
  **Expect:** the save completes with no error; reopening the file (close
  the tab, click it again in the tree) shows the edit persisted.
- [x] **New Folder / New File prompt, validate, and create** — right-click
  a folder-shaped node (the SAS Content root, an ordinary subfolder, or My
  Folder — not My Favorites or Recycle Bin) and choose **New Folder**, then
  separately **New File**.
  **Expect:** an input box titled with the parent's name; typing a name
  containing `/` is rejected in place with "A name cannot contain \"/\".";
  submitting empty is rejected with "Enter a name."; a valid name shows a
  brief progress notification ("Creating folder \"…\"…" / "Creating
  file \"…\"…"), then the new item appears in the tree, already selected
  and revealed (expanding the parent if it was collapsed) — no separate
  refresh needed.
- [x] **Rename** — right-click the folder or file just created and choose
  **Rename**.
  **Expect:** an input box titled `Rename "<name>"`, pre-filled with the
  current name; submitting the unchanged name is rejected with "That is
  already its name."; a new name shows a brief progress notification
  ("Renaming to \"…\"…") and the tree reflects it.
- [x] **Delete on an ordinary item recycles it silently** — right-click the
  renamed file and choose **Delete**.
  **Expect:** no confirmation dialog — a brief progress notification
  ("Moving \"…\" to the Recycle Bin…") and the item disappears from its
  folder. (Confirmed separately in §16 that it lands in the Recycle Bin.)
- [-] **(known gap) Delete on a top-level folder permanently deletes, behind
  a modal** — right-click a folder that sits directly under SAS Content
  (not nested inside another folder) and choose **Delete**.
  **Expect:** a blocking confirmation — "Permanently delete the folder
  \"…\" and everything inside it?" with detail "This cannot be undone." and
  a **Delete Permanently** button. Cancelling leaves it untouched;
  confirming removes it for good (not recoverable from the Recycle Bin).
  **First pass, 2026-09-11 (Sean): unable to test** — a Viya
  deployment-level configuration, set at install time, restricts deleting a
  folder directly under SAS Content for most users regardless of account
  permissions; not something an admin account bypasses, and not retestable
  on this deployment. **Deferred**: needs a deployment configured to allow
  it. Unit- and integration-tested (`content-adapter.test.ts`,
  `explorer.test.ts`) — this is a live-confirmation gap only. Do not re-tick
  this box on this deployment; rewrite it as a normal **Expect** only once
  it is actually confirmed live somewhere.
- [-] **(known gap) Dragging an item onto a folder moves it** — drag a test
  file onto a different folder.
  **Expect:** a progress notification ("Moving \"…\"…"), the item
  disappears from its old location, and it is auto-revealed (selected,
  ancestors expanded) under the new folder — no manual refresh needed.
  **First pass, 2026-09-11 (Sean): failed** — dragging a file from Windows
  Explorer does nothing (expected — see below), and dragging a file from
  within the SAS Content tree also did nothing: no progress notification,
  no message, no file movement. **Second pass, 2026-09-11 (Sean), against a
  build with ADR-0031's fix: failed identically.** No progress notification,
  no message, no file movement — same as the first pass, no visible change
  at all. Root cause remains unknown; accepted as a known gap, deprioritised
  behind Cut/Paste (below), tracked in `phase-11.md` for a future
  investigation. Do not re-tick this box on a future pass without a genuine
  fix — if drag-and-drop is ever confirmed working, rewrite this row as a
  normal **Expect** per this doc's own convention (see "Keeping this
  current").
- [ ] **Dragging multiple items moves all of them together** — select two
  or more items (Ctrl/Cmd-click) and drag them onto a folder.
  **Expect:** a progress notification naming the count ("Moving N
  items…"); all selected items move; the first one is revealed afterward.
  Not testable while the single-item case above does not work at all.
- [ ] **Dragging onto My Favorites or the Recycle Bin does nothing** — drag
  a test file onto the My Favorites row, then onto the Recycle Bin row.
  **Expect:** no error, no toast, no move — the item stays exactly where it
  was. (Neither gesture is wired to add-to-favourites or recycle; only the
  context-menu actions in §16 do that.) Trivially "passes" while
  drag-and-drop is broken outright — not meaningfully testable until the
  base gesture works, since a no-op is indistinguishable from the general
  failure above.
- [ ] **Dragging an item onto itself or its current folder is a no-op** —
  drag an item onto the folder it already lives in, and drop it directly on
  itself if your OS allows the gesture.
  **Expect:** nothing happens either way — no progress notification, no
  error. Same caveat as the row above.
- [ ] **Multi-select hides the single-item context actions** — select two
  or more items at once and right-click.
  **Expect:** New Folder, New File, Rename, Delete, Cut, and the favourite
  toggle are all absent from the context menu (they act on exactly one
  item); only Empty Recycle Bin / Restore-style bulk actions would still
  apply where relevant.
- [x] **Cut, then Paste, moves an item unambiguously (6e)** — right-click a
  test file and choose **Cut**, then right-click a *different* folder and
  choose **Paste**.
  **Expect:** Cut shows a brief info message ("Cut \"…\". Right-click a
  folder and choose Paste."); Paste shows a progress notification ("Moving
  \"…\"…"), the item disappears from its old location, and it is
  auto-revealed under the new folder — same end state as a working drag,
  reached without touching drag-and-drop at all. **Live-tested twice**:
  first under the diagnostic's original command names (2026-09-11, Sean —
  three real moves, `Demo → tst`, `tst → My Folder`, `My Folder → Demo`,
  all clean), then again, 2026-09-11, against
  [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162)'s branch
  under the final `pythonOnViya.cutContentItem`/`pasteContentItem` names —
  confirmed working. This is currently the only working way to move an
  item in this tree (drag-and-drop, above, does not work at all).
- [ ] **Paste without a Cut, or onto an invalid target, explains why** —
  right-click a folder and choose **Paste** with nothing cut yet; then Cut
  a file, and Paste it onto the folder it already lives in.
  **Expect:** "Nothing has been cut yet. Cut an item first." for the first
  case; a message naming the item, the target, and "it's already there" for
  the second — neither silently does nothing the way a missed drag would.
- [ ] **Cut is not offered on a Recycle Bin item** — expand the Recycle
  Bin and right-click an item inside it.
  **Expect:** no **Cut** entry on the context menu at all.

## 16. SAS Content — favourites and the Recycle Bin (phase 6d)

Two independent features layered on §15's tree: My Favorites, a per-account
reference list, and the Recycle Bin, where "Delete" (§15) lands for
anything that isn't a top-level folder. Both are `getChildItems`
add-ons — no favourite/recycled item gets a different icon; only its
context menu changes. **First pass ran 2026-09-11 (Sean, live), same session
as §15** — every row below passed clean, no open items.

**Pre-work:** the same signed-in connection as §15, with at least one test
folder containing a nested file (a file inside a subfolder, not directly
under SAS Content) that you don't mind recycling.

- [x] **Add to My Favorites** — right-click an ordinary folder or file (not
  a delegate, and not something already inside the Recycle Bin) and choose
  **Add to My Favorites**.
  **Expect:** a brief progress notification ("Adding \"…\" to My
  Favorites…"); expanding My Favorites now shows it, with no manual
  refresh needed. Right-clicking it again — either under My Favorites or in
  its original location — now offers **Remove from My Favorites** instead.
- [x] **A favourited item looks identical, no badge** — compare the icon of
  the item you just favourited against an ordinary sibling.
  **Expect:** the same folder or file icon either way — favouriting does
  not add a star or any other visual marker in this build. The only way to
  tell is the context menu wording. (Not a bug if true; flag it if you
  instead see a badge, since that would mean the code changed since this
  was written.)
- [x] **A favourited item browsed from My Favorites behaves like the real
  thing** — expand My Favorites and open/expand the item from there rather
  than from its original location.
  **Expect:** a favourited file opens for editing exactly as in §15; a
  favourited folder expands and lists its real children.
- [x] **Remove from My Favorites** — right-click the item under My
  Favorites and choose **Remove from My Favorites**.
  **Expect:** a brief progress notification and it disappears from My
  Favorites; its original location is untouched.
- [x] **A Recycle Bin item cannot be favourited** — expand the Recycle Bin
  (recycle something first if it's empty) and right-click an item inside
  it.
  **Expect:** neither **Add to My Favorites** nor **Remove from My
  Favorites** appears on the context menu at all.
- [x] **Restore returns an item to where it lived** — recycle a test file
  (§15's Delete), then expand the Recycle Bin, right-click it, and choose
  **Restore**.
  **Expect:** a brief progress notification ("Restoring \"…\"…"); the item
  disappears from the Recycle Bin and reappears in its original folder.
- [x] **A file nested inside a recycled folder is still recognizably
  recycled** — recycle a folder that contains a file (not a bare empty
  folder), then expand the recycled folder inside the Recycle Bin.
  **Expect:** the nested file shows as read-only (see the row below) and
  offers Restore, the same as a directly-recycled item — not as an
  ordinary editable file. (This confirms a real bug found and fixed in PR
  #159's review: `inRecycleBin` not propagating past the bin's direct
  children.)
- [x] **Recycled files open read-only** — click a file inside the Recycle
  Bin (not a file inside a recycled folder — either works, per the row
  above).
  **Expect:** it opens in the editor, but the tab is read-only (VS Code's
  padlock indicator; editing and Ctrl/Cmd+S either do nothing or show an
  error) — a different command than an ordinary open (**View Recycled SAS
  Content File** vs. **Open SAS Content File**), backed by a second,
  read-only registration of the same `FileSystemProvider`.
- [x] **Delete on an already-recycled item permanently deletes, behind a
  modal** — right-click an item already inside the Recycle Bin and choose
  **Delete**.
  **Expect:** the same blocking confirmation as a top-level folder in
  §15 — "Permanently delete \"…\"?", detail "This cannot be undone.", a
  **Delete Permanently** button — since a bin item can't be recycled again.
- [x] **Dragging into or out of the Recycle Bin does nothing** — drag an
  item from the Recycle Bin onto an ordinary folder, and drag an ordinary
  item onto the Recycle Bin.
  **Expect:** neither does anything — no move, no error, no toast. (Moving
  a recycled item out would be a restore and dropping into the bin an odd
  half-recycle; 6d deliberately defines neither as a drag gesture — only
  the context-menu actions above do this.)
- [x] **(slow) Empty Recycle Bin** — recycle two or three test items so the
  bin isn't empty, then right-click the Recycle Bin row and choose **Empty
  Recycle Bin**.
  **Expect:** a blocking confirmation — "Permanently delete everything in
  the Recycle Bin?" with detail mentioning that items other tools placed
  there (such as reports) are left alone — then a progress notification
  ("Emptying the Recycle Bin…") with **no per-item progress bar** (a known,
  accepted tradeoff — confirm it doesn't read as hung for your handful of
  items), and the bin ends up empty.

## 17. Regression spot-checks

Each of these was a real defect caught in review. Quick to confirm now that you
are set up.

- [x] **(live) Runs actually produce output** — any successful **Run File**
  shows its stdout.
  **Expect:** output appears. A run that reports success but shows nothing has
  regressed the `infile=` step-close fix (finding 70): the job can report
  `completed` with nothing flushed unless the step is closed.
- [x] **(live) Cancel is scoped to what it actually started, not to "the active
  profile"** — a *separate VS Code window* cannot reach another window's
  in-flight run at all (each window is its own extension host with no shared
  `currentRun`/`currentReset` state), so that repro can never exercise this
  item. Instead: connect on profile A in **one window**, start a 60-second
  run, then use **Select Run Target** to switch that **same window** to
  profile B mid-run, and invoke **Cancel**.
  **Expect:** A's run keeps going — Cancel acts on the backend it actually
  started the run against, not on whatever profile is active now. *(The
  2026-08-27 pass used the two-window repro this item used to describe, which
  can't test the real invariant — code-traced as correct
  (`src/run/commands.ts`'s `currentRun`/`currentReset` tracking, from PR #63),
  but re-run with the same-window repro above before ticking this box.)*
- [x] **(live) Backend re-connects after a reset** — run **Reset Python State**,
  then immediately **Run File** on the same profile.
  **Expect:** the run works — the per-profile backend cache re-calls the
  idempotent `connect()` before handing a cached backend back out.
- [x] **(live) Panel re-reveal and probe resilience** — confirmed in §8
  (re-reveal) and §9 (broken-metadata tolerance); tick here once both hold.

---

## Keeping this current

This page is meant to be re-run every phase, so it has to grow with the product.

- **Sections 0–1, 14 and 17 are phase-agnostic.** Pre-flight, activation, trust,
  enablement and the regression spot-checks apply to every build. The regression
  section grows by one bullet each time review catches a defect worth
  re-confirming by hand.
- **Sections 2–13 and 15–16 map to phases 1–3, 6a–6d and 7a–7c-ii.** When a
  phase closes, add a section (or extend one) for its user-visible behaviour,
  and cite the slice and ADR in the heading the same way the existing sections
  do. Phase 4's traceback editor-position mapping, for instance, turns the
  `ModuleNotFoundError` **(known gap)** row in §7 into a real assertion.
  Phase 6 (SAS Content) got its own live pass and sections (§15–§16) added
  2026-09-11 — later than its own phase boundary, and out of sequence with
  this rule's own "when a phase closes" cadence, since it landed inside a
  Phase 7c-ii fix branch rather than at Phase 6's own close. Reconciled by
  the Phase 6→7/8 housekeeping checkpoint (`HOUSEKEEPING.md`): the real
  drag-and-drop failures the live pass found were root-caused and fixed
  (ADR-0031), a Cut/Paste alternative shipped alongside it (ADR-0032, new
  rows in §15), and both are tracked in `phase-6.md`'s 6e Runbook entry
  rather than silently left as unchecked boxes here.
- **Retire a gap when it closes.** A **(known gap)** row is a promise to update
  it, not a permanent excuse. When the behaviour lands, rewrite the row as a
  normal **Expect**.
- **Re-run the whole thing before a release** — it is [release
  checklist](../release-checklist.md) D6, and “publishing green is not the same
  as working”.

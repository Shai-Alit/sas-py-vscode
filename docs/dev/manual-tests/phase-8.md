<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 8 (CAS and SWAT)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## CAS browsing (phase 8a)

A third, independent tree in the same activity-bar container Phase 6 added,
alongside SAS Content and SAS Libraries — servers, then global caslibs, then
tables, then (once a table is loaded) its columns
([ADR-0033](../../adr/0033-cas-adapter-shape.md)). **Not yet run** — this
section is new for Phase 8a and has no prior pass to compare against; every
box below is a first assertion, not a re-check.

**Unlike SAS Libraries, this view needs no compute session at all** —
Finding 8.2/8.7 (`docs/phases/phase-8.md`) confirmed global-scope
`casManagement` browsing needs only an endpoint and a token, the same as SAS
Content. Several boxes below exist specifically to check that contrast: this
view should populate and stay usable whether or not you have ever pressed
**Connect**, and whether or not a run is in flight.

**Pre-work:** a Viya connection, the same one §4 sets up — **sign in**, but
you do **not** need to press **Connect to SAS Viya** for this section (see
above). You do not need any CAS object of your own: every deployment probed
so far reports a `cas-shared-default` server with a `Public`, `Formats`,
`Samples`, and `SystemData` caslib, and this section's examples use those. If
your deployment differs, substitute any server/caslib/table you can see —
just avoid a caslib holding sensitive or customer data for the "expand a
table" boxes below, since expanding one loads it.

- [x] **8.1** **The view exists and reflects sign-in state, not connection
  state** — open the **Python on Viya** icon in the Activity Bar.
  **Expect:** three views stacked in the same container — **SAS Content**,
  **SAS Libraries**, and **CAS**. Before any profile is configured, CAS shows
  "Add a SAS Viya connection profile to browse CAS." with a clickable **Add
  Connection Profile** link. Signed out with a profile configured, it reads
  "Sign in to SAS Viya to browse CAS." **There is no third, "not connected"
  welcome message the way SAS Libraries has** — CAS has nothing to say about
  a compute session, because it does not use one.
- [x] **8.2** **Signing in alone populates the tree — no Connect needed** —
  sign in to a profile, but do **not** run **Connect to SAS Viya**.
  **Expect:** CAS already lists at least **cas-shared-default**, with a
  server icon and a collapsed expand chevron — no welcome text remains, even
  though SAS Libraries (right above it) still shows its own "Connect to SAS
  Viya…" welcome text at the same moment. That difference side by side is
  the point of this box.
- [x] **8.3** **Expanding a server lists its global caslibs** — click the
  chevron next to **cas-shared-default**.
  **Expect:** a list of caslibs appears, each with a database icon and an
  expand chevron, including at least **Public**, **Formats**, **Samples**,
  and **SystemData** if your deployment has them.
- [x] **8.4** **Expanding a caslib lists its tables** — expand **Public** (or
  another caslib you can see).
  **Expect:** a list of tables appears, each with a table icon and an expand
  chevron (a table is not a leaf in this phase, unlike SAS Libraries' — it
  expands to columns).
  **9/12/2026 failed** - attempted to expand P_FORD and Public caslibs and get this
  message popup "Element with id cas:cas-shared-default.Public.NREL_1000X 
  is already registered". note that neither caslib had in-memory tables loaded
  but do have saved tables present. none of the saved tables are present but
  they are not currently loaded to memory. messages like that just keep
  popping up repeatedly. checking Verde it appears the messages are popping 
  up with the name of each table in the caslib not loaded to memory. I went
  to Verde and manually loaded a table to memory and refreshed the VS Code
  CAS view and the table does not show up at all. the error messages continue
  to show up even after a refresh. signing out and signing back in and 
  re-running this procedure produces the same results. 
  **9/13/2026 passed**
- [x] **8.5** **Expanding an unloaded table loads it, then shows its
  columns** — pick a table you have not yet expanded and expand it.
  **Expect:** a short pause (the JIT-load `PUT`, Finding 8.3/8.8), then a
  list of columns appears, each with a field icon and the column's SAS type
  shown dimmed to the right of its name (e.g. `varchar`, `double`) — not a
  `404`/error, and not an empty list.
- [x] **8.6** **Re-expanding an already-loaded table shows columns
  immediately, no reload pause** — collapse the table from the box above,
  then expand it again.
  **Expect:** the same columns appear, this time with no perceptible delay —
  the table's own listing entry now reports it as loaded, so
  `CasAdapter.getColumns` skips the load `PUT` entirely.
- [x] **8.7** **Refresh reloads the tree** — click the refresh icon in the
  CAS view's title bar (hover the view's header if you don't see it), or run
  **Refresh CAS** from the Command Palette.
  **Expect:** the tree reloads. If nothing changed on the server, the visible
  list looks the same — that is a pass, not a no-op failure.
  **9/12/2026 failed** - reload does not update the tree. manually loaded a table
  to memory in Verde and then clicked refresh in VS Code CAS view. it did not 
  pick up the in memory table. 
  **9/13/2026 passed**
- [x] **8.8** **Browsing works while a compute session run is busy** — start
  a long-running selection first: open a `.py` file, type `import time;
  time.sleep(30)`, select it, and **Run Selection** (§6 has the mechanics if
  this is unfamiliar). While that run is still going, expand a caslib or
  table in **CAS** you have not yet expanded this session.
  **Expect:** it expands normally, with no delay and no "session busy"
  message — CAS browsing does not go through the compute session at all, so
  it is unaffected by a run in progress. This is the direct contrast to SAS
  Libraries' own busy-session refusal (`phase-7.md`'s 7a manual test §7.6).
- [x] **8.9** **Signing out empties the tree cleanly** — sign out of the
  profile.
  **Expect:** CAS returns to its "Add a SAS Viya connection profile…" or
  "Sign in to SAS Viya…" welcome text (whichever applies); no stale server,
  caslib, table, or column entries are left showing.
- [x] **8.10** **Legible in every theme** — with the tree expanded down to a
  column, switch VS Code between a light theme, a dark theme, and a
  high-contrast theme (Command Palette → **Preferences: Color Theme**).
  **Expect:** every icon (server, database, table, field) renders as a real
  codicon, not a broken/missing-glyph box, in all three.


## Authenticated CAS session connect (phase 8b)

**Insert CAS Connection Snippet** (`pythonOnViya.insertCasConnectionSnippet`)
writes a fresh CAS token into the active Compute session's own run directory
as a fileref, then inserts a short Python snippet that reads it back and
opens an authenticated `swat.CAS()` connection — no separate CAS credential
to acquire or paste in (`docs/cas-python-connection.md`). Unlike CAS browsing
above, this **does** need a live Compute session: the token has nowhere to
land without one. **Not yet run** — this section is new for Phase 8b and has
no prior pass to compare against; every box below is a first assertion, not
a re-check. One of these boxes (§8.14) is the slice's own non-negotiable
manual check (`docs/phases/phase-8.md`'s 8b punch list) — nothing else in
this slice can ship without it passing.

**Pre-work:** a Viya connection, signed in **and connected** (**Connect to
SAS Viya**, §4) — unlike CAS browsing, this section's command is gated on a
live session. Have an empty or existing `.py` file open. If the target
compute context's Python environment has `swat` installed, you can also run
the inserted snippet to confirm it actually connects (§8.13); if it does
not, note that box as not independently reachable and confirm only the
snippet's shape instead — that is an environment gap, not a defect in this
command.

- [x] **8.11** **The command is gated on a live session, not just sign-in** —
  signed in but **not** connected, open the Command Palette and type "Insert
  CAS Connection Snippet".
  **Expect:** the command does not appear. Run **Connect to SAS Viya**, then
  search again.
  **Expect:** it now appears. This is the direct contrast to CAS browsing
  above (§8.2), which populates on sign-in alone.
- [x] **8.12** **The happy path inserts a real connect snippet at the
  cursor** — with your cursor positioned in the open `.py` file, run **Insert
  CAS Connection Snippet** (auto-picks the CAS server if the deployment has
  only one).
  **Expect:** four lines land at the cursor, as plain text (no tabstops to
  Tab through):
  ```python
  with open("CT123456") as _cas_token_file:
      _cas_token = _cas_token_file.read().strip()
  import swat
  conn = swat.CAS("<internal-host>", <port>, password=_cas_token)
  ```
  with a real `CTnnnnnn` fileref name and this deployment's own internal CAS
  host/port (Finding 8.10) — not a placeholder.
- [ ] **8.13** **More than one CAS server prompts a QuickPick** — only
  reachable if this deployment reports more than one CAS server; if it
  reports exactly one, note this box as not independently reachable rather
  than forcing it. Run **Insert CAS Connection Snippet** again.
  **Expect:** a QuickPick titled to select a CAS server appears, listing each
  by name; picking one inserts a snippet with that server's own host/port.
  **(9/13/2026) not independently reachable** - only one cas server available
  on test environment
- [x] **8.14** **The delivered token never appears in the job log (the
  slice's own non-negotiable check)** — with **Python on Viya: Show Log**
  open (or watching the job log directly), run **Insert CAS Connection
  Snippet**, then run the inserted snippet with **Run File**.
  **Expect:** nowhere in the log or job output does the raw token value
  appear in plaintext — the token travels only as the uploaded fileref's raw
  bytes, never through a submitted statement (`docs/cas-python-connection.md`,
  "Why there is no `password="..."` literal to see"; ADR-0014). This is the
  exact leak Finding 8.6's earlier inline attempt had.
- [x] **8.15** **Running the snippet actually connects (needs `swat` in the
  session's Python environment — see this section's pre-work)** — with the
  inserted snippet still selected or the file otherwise runnable, **Run
  File**, then run `print(conn)` or `print(conn.serverstatus())` in a
  follow-up cell/run.
  **Expect:** no error — `conn` is a live, authenticated `swat.CAS` object
  against this deployment's own CAS server.
- [x] **8.16** **Running the command again delivers a fresh token, not a
  reused one** — with a snippet already inserted from an earlier box, run
  **Insert CAS Connection Snippet** a second time.
  **Expect:** the newly inserted snippet's `open("CTnnnnnn")` line names a
  **different** fileref than the previous insert — confirming each run
  delivers its own fresh token rather than reusing one across calls
  (`docs/cas-python-connection.md`, "Reconnecting after a while").
- [x] **8.17** **No active Compute session reports clearly, without
  touching the editor** — disconnect (**Disconnect from SAS Viya**), then
  (if the command is still reachable, e.g. via re-running it from history)
  attempt **Insert CAS Connection Snippet**; if the enablement gate in
  §8.11 already hides it entirely, confirm that instead and treat this box
  as covered by that one.
  **(9/13/2026) already covered**
  **Expect:** either the command is unavailable, or it reports "Connect to
  SAS Viya first, then run this command again." and inserts nothing.
- [x] **8.18** **No Python editor open reports clearly** — close every editor
  tab (or focus a non-editor view), then run **Insert CAS Connection
  Snippet** from the Command Palette.
  **Expect:** a message reading "Open a Python file first, then run this
  command again."; nothing is inserted anywhere.
  **(9/13/2026) failed** — the command inserted into any focused file (e.g.
  `.md`), not just `.py`; the gate only checked whether an editor was open at
  all, not its language. **Fixed same day** in code (the gate now checks
  `editor?.document.languageId !== "python"`, the same check
  `src/run/commands.ts`'s Run Selection/Run File commands already use) and
  covered by a new automated regression test (`phase-8.md`'s 8b Runbook).
  **Re-confirmed live the same day (Sean)** — closing this box.
- [x] **8.19** **Loaded vs. unloaded CAS tables show different icons** —
  folded into this slice after 8a's own manual pass flagged the gap
  (`docs/phases/phase-8.md`'s 8b Runbook). In the **CAS** tree, find a table
  you have not yet expanded this session and one you have already expanded
  (loaded — see §8.5/§8.6 above).
  **Expect:** the unloaded table shows a cloud icon (data at rest in the
  caslib's own backing store); the already-loaded table shows the ordinary
  table icon — visibly different glyphs, not the same icon for both the way
  8a originally shipped.
- [x] **8.20** **Legible in every theme** — with an inserted snippet visible
  and both a loaded and an unloaded table showing in the CAS tree, switch VS
  Code between a light theme, a dark theme, and a high-contrast theme.
  **Expect:** the snippet is ordinary Python syntax highlighting (nothing new
  to check there); the cloud icon from §8.19 renders as a real codicon, not a
  broken/missing-glyph box, in all three.

## CAS tables in the data viewer (phase 8c)

A CAS table's tree node opens in the same paged, sortable, filterable grid
Phase 7 built for Compute session tables (`pythonOnViya.openCasTable`),
reached via the shared `DataViewerPanelManager` generalized behind a
`TableSource` interface ([ADR-0034](../../adr/0034-table-source-abstraction.md))
rather than a second, forked panel. **Not yet run** — this section is new for
Phase 8c and has no prior pass to compare against; every box below is a first
assertion, not a re-check. Added 2026-09-14 at the Phase 8→9 housekeeping
checkpoint, which found 8c had shipped and merged with no manual-test section
tracking it at all — the same gap that checkpoint's Phase 7→8 predecessor
found and fixed for 7c-iii's CSV export.

**Pre-work:** the same CAS pre-work as the phase 8a section above — a Viya
connection, signed in (no **Connect** needed). Have at least one table you
can open — any of `Public`/`Formats`/`Samples`/`SystemData`'s tables will do.

- [x] **8.21** **Opening a CAS table opens the shared data-viewer panel** —
  in the **CAS** tree, expand a caslib down to a table and click it (or use
  its context menu), the same gesture **SAS Libraries**' own table nodes use.
  **Expect:** the same paged/sortable/filterable grid Phase 7 built opens,
  populated with this table's real rows and columns — not an empty or
  errored panel.
  **(9/14/2026) failed** — opening a table (confirmed already loaded into
  memory) showed "The CAS management service refused the request (HTTP
  302). See the Python on Viya log for details." in the panel, with no
  further detail in the log. Root-caused live: the `dataTable` relation
  8c's own `CasAdapter.openTable` follows really does `302` on this
  deployment (Finding 8.11 had already found this in prose but never pinned
  the literal `Location`), and `CasClient.send` had no redirect handling at
  all. **Fixed** — `src/cas/client.ts` now follows exactly one `GET`
  redirect to a root-relative `Location`, re-probed and pinned as Finding
  8.14; see `phase-8.md`'s "Post-merge fixes, 2026-09-14" Runbook entry.
  **9/14/2026 passed**
- [x] **8.22** **Opening an unloaded table loads it first (JIT-load)** — pick
  a table you have not yet expanded or loaded this session and open it
  directly via the data viewer gesture above, without expanding it in the
  tree first.
  **Expect:** a short pause (the load `PUT`, Finding 8.3/8.8, the same one
  8a's own §8.5 exercises via the tree), then the grid populates — not an
  error, and not an empty grid.
- [x] **8.23** **Sort and filter work, independently and together** — in the
  opened panel, sort by a column, then clear it and filter instead, then
  apply both together.
  **Expect:** results update correctly for each combination, with no
  noticeable delay from a view-creation step — Finding 8.12 found CAS needs
  none, unlike a Compute session table.
  **9/14/2026 failed** inputing a where clause fails with
  "The CAS management service refused the request (HTTP 409). See the Python on Viya log for details. 2-6-2710405: 0x887ff995:TKCASDAL_WHERE_PARSEERROR"
   in the panel and "2026-09-14 07:21:46.793 [warning] CAS: a row request over "P_FORD.BASEBALL" failed (the CAS management service returned HTTP 409 (2-6-2710405: 0x887ff995:TKCASDAL_WHERE_PARSEERROR, correlator 9f27da98-0e25-453a-879f-79c647b3337e))" in the log.
  **Root-caused, same session:** the filter text itself
  (`'CrHits'>200`) was invalid syntax — a quoted column name; Sean confirmed
  live that the correct, unquoted form (`CrHits>200`) works. CAS correctly
  refused it, but the message shown discarded CAS's own explanation: its
  `details[]` array puts an opaque `"N-N-N: 0xHEX:SYMBOL"` diagnostic code
  first and the actual parser sentence (`"ERROR: The WHERE clause '…' could
  not be resolved."`) after it, and `readViyaError` was taking the first
  entry — the code, not the sentence. Re-probed live and pinned as Finding
  8.15. **Fixed** — `src/wire/viyaError.ts` now prefers the first
  `ERROR:`-prefixed `details[]` entry; see `phase-8.md`'s "Post-merge fixes,
  2026-09-14" Runbook entry, Bug 3. Not a client-side syntax validator —
  an invalid filter still fails, now with CAS's own actionable sentence
  instead of a bare code.
  **9/14/2026 passed** — re-tried `'CrHits'>200` (now explains itself) and
  a valid filter/sort combination (Sean).
- [x] **8.24** **Opening the same table twice reveals the existing panel,
  not a duplicate** — with a CAS table already open, trigger the same open
  gesture on it again (from the tree or the Command Palette history).
  **Expect:** the existing panel is revealed/refocused; no second tab or
  panel appears for the same table.
- [ ] **8.25** **Switching deployments does not leak a stale panel** — open
  a CAS table on one connection profile, then switch to a different Viya
  connection profile whose deployment happens to expose a server/caslib/table
  with the exact same names, and open that one.
  **Expect:** a distinct panel opens for the new deployment's table, not a
  reveal of the first profile's panel — the cross-deployment isolation
  [ADR-0034](../../adr/0034-table-source-abstraction.md) added `CasAdapter`'s
  own `endpoint` field for. **If no second profile with matching names is
  available, note this box as not independently reachable** rather than
  forcing it — the same allowance §8.13 above takes for a single-CAS-server
  deployment.
- [x] **8.26** **Closing the panel disposes cleanly** — close the CAS
  table's data-viewer tab/panel.
  **Expect:** no error appears in **Python on Viya: Show Log** or the
  DevTools console; reopening the same table afterward opens a fresh panel
  with correct data, not a stale or broken one.
- [x] **8.27** **Legible in every theme** — with a CAS table open in the data
  viewer, switch VS Code between a light theme, a dark theme, and a
  high-contrast theme.
  **Expect:** the grid renders correctly in all three, matching Phase 7's own
  data viewer — nothing CAS-specific to the rendering here.
- [x] **8.28** **A table's icon flips to "loaded" the moment it
  finishes loading, with no manual refresh** — found testing this section,
  though the bug itself is in the **CAS** tree (phase 8a), not the data
  viewer: expand a table you have not yet loaded this session (§8.5) and
  watch its own icon as the columns appear, without running **Refresh CAS**.
  **Expect:** the icon flips from the cloud glyph (§8.19) to the ordinary
  table glyph as soon as the columns finish loading — not only after a
  manual refresh.
  **(9/14/2026) failed** — the icon stayed on the cloud glyph until
  **Refresh CAS** was run by hand, even though the columns themselves loaded
  and displayed correctly (§8.5 still passes on its own terms). A fix landed
  (`src/cas/casTree.ts`'s `getChildren` now fires `onDidChangeTreeData` with
  a state-updated copy of the table node once `CasAdapter.getColumns`'s own
  JIT-load succeeds) and was refined twice more over PR #173's own review —
  see `phase-8.md`'s "Post-merge fixes, 2026-09-14" Runbook entry, Bug 2, for
  the full account. **Re-confirmed live 2026-09-14 (Sean): still fails** —
  the icon still does not flip in a real VS Code window, despite the fix
  passing every unit/integration test written against it. Root cause not
  found this session; per Sean's own call, not worth chasing further inside
  this PR. **Deferred to Phase 10/11 as a known gap** — see
  [`phase-11.md`](../../phases/phase-11.md)'s "carried here" list.
  **(9/15/2026) passes** — root cause found and a second fix landed, then
  confirmed live by Sean against a `.vsix` built from the fix: the icon flips
  from cloud to table as the columns appear, with no **Refresh CAS**.
  `onDidChangeTreeData` resolves a fired element by object identity, not by
  `TreeItem.id`, so the state-updated *copy* the first fix fired was
  discarded silently; `src/cas/casTree.ts` now fires the identical element
  object and overlays the loaded state in `getTreeItem`. Full account:
  [`phase-8.md`](../../phases/phase-8.md)'s "Icon-flip gap: root cause
  found, 2026-09-15" Runbook entry. **This item is the reason that entry
  insists on a live re-run** — the first fix passed every automated check
  and still failed here, so a green suite was never sufficient evidence.


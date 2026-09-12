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
- [-] **8.4** **Expanding a caslib lists its tables** — expand **Public** (or
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
- [ ] **8.5** **Expanding an unloaded table loads it, then shows its
  columns** — pick a table you have not yet expanded and expand it.
  **Expect:** a short pause (the JIT-load `PUT`, Finding 8.3/8.8), then a
  list of columns appears, each with a field icon and the column's SAS type
  shown dimmed to the right of its name (e.g. `varchar`, `double`) — not a
  `404`/error, and not an empty list.
- [ ] **8.6** **Re-expanding an already-loaded table shows columns
  immediately, no reload pause** — collapse the table from the box above,
  then expand it again.
  **Expect:** the same columns appear, this time with no perceptible delay —
  the table's own listing entry now reports it as loaded, so
  `CasAdapter.getColumns` skips the load `PUT` entirely.
- [-] **8.7** **Refresh reloads the tree** — click the refresh icon in the
  CAS view's title bar (hover the view's header if you don't see it), or run
  **Refresh CAS** from the Command Palette.
  **Expect:** the tree reloads. If nothing changed on the server, the visible
  list looks the same — that is a pass, not a no-op failure.
  **9/12/2026 failed** - reload does not update the tree. manually loaded a table
  to memory in Verde and then clicked refresh in VS Code CAS view. it did not 
  pick up the in memory table. 
- [ ] **8.8** **Browsing works while a compute session run is busy** — start
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

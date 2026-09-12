<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 2 (Connect and the compute session)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

## Connect and the compute session — phase 2a

One session per folder, per profile ([ADR-0012](../../adr/0012-compute-session-lifetime-and-storage.md)).
Reload reconnects; it does not restart.

- [x] **2.1** **(live) Cold-start Connect** — signed out, run **Connect to SAS Viya**.
  **Expect:** it signs you in first, shows a progress notification while the
  session opens, then an info message naming the profile. **Failed,
  2026-08-27** — while signed out, **Connect to SAS Viya** does not appear in
  the palette at all; **Sign In** has to be run manually first, and only then
  does Connect appear. Tracked in Phase 3's **3f** slice alongside the other
  "Connect won't come back" findings below — re-run once that lands.
- [x] **2.2** **(live) Context picker and write-back** — profile with no `context`: the
  first connect lists contexts. Dismiss it once; connect again and pick a
  working one.
  **Expect:** dismiss → connect cancels, nothing written. After a session
  actually starts, `context` is written back into the profile in
  `settings.json`.
- [x] **2.3** **(live) Reload reconnects with state intact** — run selection `k = 99`
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
- [x] **2.4** **(live) Disconnect ends it now** — run **Disconnect from SAS Viya**, then
  run selection `print(k)` again.
  **Expect:** a fresh interpreter opens and `k` is gone (`NameError`).
- [x] **2.5** **(live) Shared vs independent sessions** — a plain **File → Open
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
- [x] **2.6** **(live) (slow) Idle reap** — connect, leave idle past the deployment
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
- [x] **2.7** **(live) Error surfaces read sensibly** — reach what you can: Viya target
  with no active profile; a context you can see but cannot launch; Cancel
  mid-connect.
  **Expect:** “Select a … profile”; a two-readings message; **silence** after
  Cancel. **Show Log** carries status codes and correlation ids.


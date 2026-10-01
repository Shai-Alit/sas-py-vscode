<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 13 (Feature completion)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

> Renumbered from Phase 12 to Phase 13, 2026-09-22 — see
> `docs/phases/phase-13.md`'s own provenance note.

Add numbered items here (`13.1`, `13.2`, …) as slices land, the same way
every other phase file did.

## 13a — upload to and download from SAS Content

See `docs/phases/phase-13.md`'s "13a built" Runbook entry. Build a `.vsix`
from this branch, install it, and sign in to a Viya profile. Make a scratch
folder under **My Folder** in the SAS Content view first (**New Folder**,
say `upload-test`), and a local scratch folder with a `.py`, a `.csv`, a
`.png` and a file with no extension in it. Delete both afterwards.

- [x] **13.14** **Upload several files.** Right-click `upload-test` →
  **Upload Files...**, pick all four local files. **Expect:** a cancellable
  notification counting through them, then `Uploaded 4 files to
  "upload-test".`, and all four under the folder. Open the `.py` from the
  tree: its text matches the local file.
- [x] **13.15** **A name already taken.** Upload the `.py` into `upload-test`
  again, together with one new file. **Expect:** the new file is uploaded,
  and an error `Uploaded 1 of 2 files to "upload-test". Could not upload
  "<name>.py".` followed by SAS Viya's "already exists" sentence. The
  **Python on Viya** log has the technical line.
- [x] **13.16** **A blocked type.** Copy any small file locally and rename
  the copy to `test.exe`. Upload it. **Expect:** `Could not upload
  "test.exe". SAS Viya refused it:` followed by the sentence saying the
  type is blocked. Nothing new appears in the folder.
- [x] **13.17** **Too large.** Make a local file over 100 MB (in Git Bash:
  `head -c 110000000 /dev/urandom > big.bin`) and upload it. **Expect:**
  `Could not upload "big.bin". It is larger than the 100 MB SAS Viya accepts
  for one file.` quickly, with nothing sent. Delete `big.bin`.
- [x] **13.18** **Download a file.** Right-click the uploaded `.png` →
  **Download...**, pick an empty local folder. **Expect:** `Downloaded 1 file
  from "<name>.png".` with **Show in Folder**, which opens the folder with
  the file selected. The file opens as the same image.
- [x] **13.19** **Download a folder, and replace.** Add a sub-folder with one
  file inside `upload-test`, then download `upload-test` into the same local
  folder. **Expect:** `upload-test` locally with every file and the
  sub-folder. Download it again to the same place. **Expect:** a modal
  saying it already exists; **Cancel** leaves it untouched, **Replace**
  overwrites it. If a data flow is available in your SAS Content, download
  its folder too. **Expect:** the summary says 1 item was left out, and the
  log names it.
- [x] **13.20** **Cancel.** Upload 10 or more files and click **Cancel** on
  the notification partway. **Expect:** no error notification, and
  `Upload to "upload-test" cancelled. <n> of <total> files were uploaded.`,
  where `<n>` is the number of files now in the folder from this upload —
  the ones before the cancel, and none after it. Then download
  `upload-test` to an empty local folder and cancel it partway the same way.
  **Expect:** `Download of "upload-test" cancelled. <n> of <total> files
  were downloaded.`, no **Show in Folder**, and `<n>` files on disk.
- [x] **13.21** **Not in the Recycle Bin, and not on a data flow.** Delete a
  file from `upload-test` (it goes to the **Recycle Bin**), then right-click
  it in the Recycle Bin. **Expect:** no **Download...** in the menu.
  **Restore** it. If a data flow is available in your SAS Content,
  right-click it → **Download...**. **Expect:** `"<name>" can't be
  downloaded. Only files and folders can be.`, with no folder picker.

## 13b — Copy and Paste in SAS Content

See `docs/phases/phase-13.md`'s "13b built" Runbook entry. Build a `.vsix`
from this branch, install it, and sign in to a Viya profile.

**Set up**, all in the SAS Content view. Under **My Folder**, make a folder
`copy-test` (**New Folder**). In `copy-test`, make two sub-folders, `dest`
and `sub`. Then use **Upload Files...** (13a) to put three small files in
place: `a.py` (any text) and `pic.png` (any image) into `copy-test`, and
`b.py` into `sub`. Make sure **My Folder** has no folder named
`copy-test_Copy1` to `copy-test_Copy4`. You should have:

```text
My Folder
└── copy-test
    ├── dest        (empty)
    ├── sub
    │   └── b.py
    ├── a.py
    └── pic.png
```

Run the items in order: each one starts from what the one before left.
Every **Copy** and **Paste** below is on the right-click menu of the item
named. When you finish, delete `copy-test` and `copy-test_Copy1` to
`copy-test_Copy4` from **My Folder**, then empty the **Recycle Bin**.

- [x] **13.22** **Copy a file, twice into one folder.** Right-click `a.py`
  → **Copy**. **Expect:** the message `Copied "a.py". Right-click a folder
  and choose Paste.` Right-click `dest` → **Paste**. **Expect:** `a.py`
  appears under `dest` and is selected, with no message. Open
  `dest/a.py`: its text matches `copy-test/a.py`. Right-click `dest` →
  **Paste** again, without copying again. **Expect:** `a_Copy1.py` appears
  under `dest`, and the message `Pasted as "a_Copy1.py", because "dest"
  already has an item named "a.py".`
- [x] **13.23** **Into its own folder, and an image.** Right-click
  `pic.png` → **Copy**, then right-click `copy-test` → **Paste**.
  **Expect:** `pic_Copy1.png` appears beside `pic.png` in `copy-test`.
  Right-click `pic_Copy1.png` → **Download...** (13a), save it, and open
  the saved file. **Expect:** the same image as `pic.png`.
- [x] **13.24** **Copy a folder.** `copy-test` now holds 6 files: `a.py`,
  `pic.png`, `pic_Copy1.png`, `dest/a.py`, `dest/a_Copy1.py` and
  `sub/b.py`. Right-click `copy-test` → **Copy**, then right-click **My
  Folder** → **Paste**. **Expect:** a progress notification, then `Copied
  6 files into "copy-test_Copy1".` `copy-test_Copy1` is selected in the
  tree; expand it and check it has the same folders and files as
  `copy-test`.
  **Optional, only if your SAS Content has a data flow you may move:** move
  one into `copy-test` first, then do the step above. **Expect:** the
  message ends `1 item was left out. See the Python on Viya log for which,
  and why.`, and the **Python on Viya** output channel has a line naming
  the data flow with `it is not a file`. Move the data flow back
  afterwards.
- [x] **13.25** **A folder into itself.** Right-click `copy-test` →
  **Copy**, then right-click `copy-test` itself → **Paste**. **Expect:**
  `Copied 6 files into "copy-test".`, and a new folder `copy-test` inside
  `copy-test`. Expand it. **Expect:** the 6 files and 2 sub-folders listed
  in 13.24, and no `copy-test` inside it — the copy holds the tree as it
  was before the paste and does not repeat. Delete the inner `copy-test`
  before going on.
- [x] **13.26** **Cut and Copy share one clipboard.** Right-click `a.py` →
  **Copy**. Then right-click `pic_Copy1.png` → **Cut**. Then right-click
  `dest` → **Paste**. **Expect:** `pic_Copy1.png` moves from `copy-test`
  into `dest`, and no new `a.py` copy appears anywhere: the later Cut
  replaced the Copy. Right-click any folder. **Expect:** no **Paste** entry,
  since a cut is used up by its paste. Now right-click `a.py` → **Copy**
  again, then switch to another connection profile (or sign out and sign
  back in). Right-click any folder. **Expect:** no **Paste** entry.
- [x] **13.27** **Where Copy and Paste refuse.** Right-click
  `dest/a_Copy1.py` → **Delete**; it goes to the **Recycle Bin**. Expand
  the **Recycle Bin** and right-click `a_Copy1.py` there. **Expect:** no
  **Copy** entry. Right-click `copy-test/a.py` → **Copy**, then right-click
  the **Recycle Bin**, and then `a_Copy1.py` inside it. **Expect:** no
  **Paste** entry on either. Expand **SAS Content** and right-click a folder
  directly under it, such as `Public` → **Copy**. **Expect:** the error
  `"<name>" cannot be copied from here.`: **Copy** is on the menu, but a
  top-level folder cannot be copied. **Optional, only if a data flow is
  available:** right-click it → **Copy**. **Expect:** the error `"<name>"
  can't be copied. Only files and folders can be.` **Copy** is on its menu
  too, since a data flow shares a file's menu.
  Pasting *into* a top-level folder such as `Public` is not refused: any
  signed-in user may add there (Finding 13.12).
  **(10/1/2026)** Passed. A paste of `a.py` into `Public` worked, as
  intended.
- [x] **13.28** **Cancel a folder copy.** Upload 10 or more files into
  `sub`, so the copy takes long enough to cancel. Right-click `copy-test` →
  **Copy**, then right-click **My Folder** → **Paste**. While the
  notification is still counting, click its **Cancel** button.
  **Expect:** no error, and the message
  `Copy of "copy-test" cancelled. <n> of <total> files were copied into "copy-test_Copy2".`
  Expand
  `copy-test_Copy2` and count its files. **Expect:** `<n>`, or `<n> + 1`
  if the file being copied at the moment of the cancel still arrived (the
  server may finish a copy it already received).
- [x] **13.29** **Two pastes of one copy at once.** Right-click
  `copy-test` → **Copy**. Right-click **My Folder** → **Paste**, then at
  once, while the first notification is showing, right-click **My Folder**
  → **Paste** again. **Expect:** two notifications, both ending in a
  `Copied <n> files into ...` message, no error, and two new folders,
  `copy-test_Copy3` and `copy-test_Copy4`, each with the same contents.
  Two pastes this close can both choose the same free name; the second
  then tries once more under the next one. Whether a hand-driven double
  paste is fast enough to hit that is luck, so this checks only that it
  never errors; the race itself is covered by `content-copy.test.ts`.

## 13n — output after a `SAS.submit()` graph

See `docs/phases/phase-13.md`'s "13n built" Runbook entry. Build a `.vsix`
from this branch, install it, and connect a Viya profile. The files are in
`test/smoke/`. On v0.1.4 each of these shows no printed output.

- [x] **13.1** **Output after `PROC SGPLOT`.** Run File on
  `release_smoke_sgplot.py`. **Expect:** all three `sgplot demo` lines in
  **Python on Viya: Output**, then `Finished.`, and the scatter plot in the
  Result panel.
- [x] **13.2** **A traceback after `PROC SGPLOT`.** Uncomment the file's
  last line and Run File again. **Expect:** the three lines, then a
  `ZeroDivisionError` traceback in the Result panel and a Problems entry on
  that line. Then, without reconnecting, Run File on
  `release_smoke_traceback.py`. **Expect:** its traceback and Problems
  entries as its header comment describes. Restore the comment afterwards.
- [x] **13.3** **The smoke test.** Run File on `release_smoke.py` twice.
  **Expect:** every check's line in the output channel, a summary with no
  `FAIL`, and each `LOOK` item's output in the Result panel.
- [x] **13.4** **A notebook.** Open `release_smoke.ipynb`, pick the
  **Python on Viya** kernel and **Run All**. **Expect:** every cell's printed
  lines, the 5-row `SAS.show` table, the bar chart and the 3-row
  `proc print` table in their cells. **Clear All Outputs** before closing.
- [x] **13.5** **After a cancel.** Run File on `release_smoke_cancel.py` and
  cancel it as its header comment describes. Once the next run can start,
  Run File on `release_smoke_sgplot.py` with its last line uncommented.
  **Expect:** the same as 13.2: the three lines and the traceback. Restore
  the comment afterwards.

## 13l — the MCP server for Claude Code

> **Retired 2026-09-30.** The server was removed before any release
> ([ADR-0044](../../adr/0044-the-mcp-server-for-claude-code-is-removed.md)).
> These items stay as the record of 13l's pass. Do not run them.

See `docs/phases/phase-13.md`'s "13l built" and "13l picked up" Runbook
entries and
[ADR-0042](../../adr/0042-a-local-mcp-server-for-claude-code.md). Install a
`.vsix` built from this branch and the Claude Code command-line tool
(`claude --version` works in a terminal). Leave
`pythonOnViya.agentServer.enabled` unset in user, workspace and folder
settings before 13.6. The server needs no Viya connection. The **Python on
Viya** output channel logs each start (`… is listening on
http://127.0.0.1:<port>/mcp.`) and each stop, and at the **Debug** log
level each refused request.

- [x] **13.6** **Off by default.** Open a trusted folder. **Expect:** the
  output channel has no `listening` line. Run **Python on Viya: Set Up
  Claude Code Access**. **Expect:** a modal asks "Turn on the MCP server for
  Claude Code?". Choose **Cancel**. **Expect:** nothing else happens, and the
  setting is still unset.
- [x] **13.7** **No folder, and Restricted Mode.** In a window with no
  folder open, run the command. **Expect:** a warning that says to open a
  folder first. Open a folder you have not trusted and choose Restricted
  Mode, then run the command. **Expect:** a warning that the server needs a
  trusted workspace, and no `listening` line.
- [x] **13.8** **Set up and connect.** In a trusted folder, run the command
  and choose **Turn On**. **Expect:** a `listening` line, and a notice that
  the registration command was copied for your default terminal shell.
  Choose **Paste into a New Terminal**. **Expect:** a terminal named
  **Claude Code setup** opens in the folder with the line typed but not run.
  Press Enter. **Expect:** `Added http MCP server python-on-viya to local
  config`. Run `claude` in that terminal and accept its folder-trust prompt
  if it asks, then run `/mcp`. **Expect:** **python-on-viya** is connected
  and lists no tools. **Expect:** the output channel shows no refused
  request, and neither it nor the terminal shows the secret. In Git Bash, run
  `netstat -ano | findstr LISTENING | findstr :45123` with the port in place
  of `45123` (`lsof -nP -iTCP:45123 -sTCP:LISTEN` off Windows).
  **Expect:** only `127.0.0.1:45123`, never `0.0.0.0` or `[::]`. At the
  **Debug** log level each connection also logs one refused `400`: Claude
  Code 2.1.284 tries the 2026-07-28 revision first, then falls back ("13l
  picked up", probe (a′)). **Watch for** a prompt to sign in to Claude Code
  in VS Code again. On the parked branch, as 12.43 on 2026-09-29, Sean had
  to sign in again after this step.
- [x] **13.9** **A reload needs no new registration.** Leave `claude`
  running from 13.8. Run **Developer: Reload Window**. **Expect:** a new
  `listening` line on the same port. In Claude Code, run `/mcp` and choose
  **Reconnect** for python-on-viya. **Expect:** it reconnects without
  registering again. In a second terminal in the folder, run
  `claude mcp list`. **Expect:** python-on-viya as connected.
- [x] **13.10** **Each Windows shell's line runs.** Windows only. For each
  of Command Prompt, PowerShell and Git Bash: pick it with **Terminal:
  Select Default Profile**, run the command again, choose **Paste into a New
  Terminal**, and press Enter. **Expect:** each time, the earlier
  registration is removed without an error on screen and
  `Added http MCP server python-on-viya to local config` follows. Then
  `claude mcp list` shows it connected.
- [x] **13.11** **Turning it off.** Note the headers file path in the
  output channel's last `Claude Code registration command:` line. Set
  `pythonOnViya.agentServer.enabled` to `false`. **Expect:** `The MCP server
  for Claude Code stopped.`, and that file no longer exists. `claude mcp list`
  shows python-on-viya failing to connect. Now hold the port with a listener
  that prints what reaches it, with the port in place of `45123`:
  `node -e "require('http').createServer((q,s)=>{console.log(q.method,q.url,'authorization' in q.headers);s.writeHead(404);s.end()}).listen(45123,'127.0.0.1')"`.
  In another terminal in the folder, run `claude mcp list`. **Record** in
  the Runbook whether the listener printed anything: Claude Code reaching a
  program that is not this server, in a folder it trusts. Stop the `node`
  process. Set the setting back to `true`. **Expect:** a new `listening`
  line on the same port, and `claude mcp list` connected again. Run
  **Workspaces: Manage Workspace Trust** and choose **Don't Trust**.
  **Expect:** after the window reloads, no `listening` line, and no
  `mcp-headers-*.json` file beside the one you noted. Trust the folder
  again. **Expect:** a `listening` line on the same port.
- [x] **13.12** **The port is taken.** Note the port from the last
  `listening` line, then set the setting to `false`. In a terminal, hold that
  port with the port number in place of `45123`:
  `node -e "require('net').createServer().listen(45123, '127.0.0.1')"`.
  Leave it running and set the setting to `true`. **Expect:** a warning that
  the server moved to a new port, with **Register Again**, and a `listening`
  line on a different port. Choose **Register Again**, then paste and run
  the line. **Expect:** `claude mcp list` shows python-on-viya connected on
  the new port. Stop the `node` process.
- [x] **13.13** **Refusals.** With the server on, set the **Python on Viya**
  output channel's log level to **Debug** (the gear icon in the Output view).
  Then run each of these in Git Bash with the current port in place of
  `45123`, and a body of `{}`:
  - `curl -si -X POST http://127.0.0.1:45123/mcp -H "Content-Type: application/json" -d "{}"`.
    **Expect:** `401`, `WWW-Authenticate: Bearer realm="python-on-viya"`,
    and the body `Unauthorized`.
  - The same with `-H "Origin: https://example.com"` added. **Expect:** `403`
    and `Origin not allowed`.
  - The same with `-H "Host: example.com:45123"` added. **Expect:** `403`
    and `Host not allowed`.

  **Expect:** the output channel shows one `refused a request` debug line
  for each, with the status and message only. Set the log level back to
  **Info**: the lines no longer appear.

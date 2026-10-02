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

## 13f — a notebook cell displays its result

See `docs/phases/phase-13.md`'s "13f built" Runbook entry. Build a `.vsix`
from this branch, install it, and sign in to a Viya profile. Create
`display-test.ipynb`, pick the **Python on Viya** kernel, and run the
items in order in that notebook unless an item says otherwise.

- [x] **13.30** **A trailing value.** Run a cell holding
      `import pandas as pd` and
      `df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})`, then a
      cell holding only `df`. **Expect:** the first cell shows nothing; the
      second shows the table as HTML, in the notebook's table styling. Run
      a cell holding `x = 41` and `x + 1`. **Expect:** `42`, in plain text.
- [x] **13.31** **The semicolon, and `None`.** Run a cell holding `df;`,
      then one holding `print("hi")`. **Expect:** the first shows nothing;
      the second shows `hi` once, with no `None` after it.
- [x] **13.32** **A plot left open.** Run a cell holding
      `import matplotlib.pyplot as plt` and `plt.plot([1, 3, 2])`.
      **Expect:** one figure, as a PNG, and no repr of the line list. Run a
      cell holding `plt.plot([1, 2]); plt.show()`. **Expect:** one figure.
      Run a cell holding `plt.plot([1, 2]); plt.close()`. **Expect:**
      nothing.
- [x] **13.33** **seaborn and pandas.** If the server has seaborn, run
      `import seaborn as sns` and
      `sns.barplot(x=["a", "b"], y=[1, 2]);`. **Expect:** one figure. Run
      `df.plot(x="a", y="a");`. **Expect:** one figure. Note in the Runbook
      entry if seaborn is missing on the server.
      **(10/1/2026)** the server does not have seaborn; the `df.plot`
      half passed.
- [x] **13.34** **A figure shown twice.** Run a cell holding
      `fig = plt.figure(); plt.plot([1, 2]); fig.savefig("twice.png")`.
      **Expect:** the figure twice, as `docs/notebooks.md` says.
- [x] **13.35** **A cell that raises.** Run a cell holding
      `plt.plot([1, 2])` on line 1, a blank line 2, and `1 / 0` on line 3.
      **Expect:** the `ZeroDivisionError` traceback with no
      `_pyviya_run_cell` frame in it, one **Problems** entry on line 3 of
      that cell, and the figure still shown. Run a cell holding `1 / 0` as
      its only line, the trailing expression. **Expect:** the entry on
      line 1.
- [x] **13.36** **A syntax error.** Run a cell holding `x = 1` and
      `print(`. **Expect:** a `SyntaxError` naming line 2, with the source
      line and caret, and no `_pyviya_run_cell` or `ast.py` frame. The next
      cell runs normally.
- [x] **13.37** **`os.chdir`.** Run a cell holding `import os` and
      `os.chdir("/tmp")`, then a cell holding `plt.plot([3, 1])`, then one
      holding `df`. **Expect:** the figure and the table both show.
- [x] **13.38** **The interactive window.** Run **Python on Viya: New
      Interactive Window**, and run `import pandas as pd` and
      `pd.DataFrame({"a": [1]})` in it. **Expect:** the table as HTML.
- [x] **13.39** **Run File is unchanged.** Save a `.py` file holding
      `x = 41`, `x + 1` and `import matplotlib.pyplot as plt;
      plt.plot([1, 2])`, and use **Run File**. **Expect:** no `42` in the
      output channel and no figure in the Result panel.
- [x] **13.40** **After reconnecting.** **Disconnect**, then run the
      notebook's `df` cell again. **Expect:** the run starts a new session
      and the table shows.
- [x] **13.41** **`from __future__`.** Run a cell holding
      `from __future__ import annotations`,
      `def f(a: Missing) -> int: return 1` and `f.__annotations__`.
      **Expect:** `{'a': 'Missing', 'return': 'int'}`, and no `NameError`.
- [x] **13.42** **A `_repr_html_` that raises.** Run a cell defining
      `class Broken:` with `def _repr_html_(self): raise ValueError("no html")`
      and `def __repr__(self): return "Broken()"`, then a cell holding
      `Broken()`. **Expect:** one line naming
      `Broken._repr_html_() raised ValueError('no html')`, then `Broken()`,
      and no failure. Run a cell holding `Broken`, the class. **Expect:**
      `<class '__main__.Broken'>` and no `raised` line.

## 13p-i — the SAS Server view: browse, open and save

See `docs/phases/phase-13.md`'s "13p-i built" Runbook entry. Build a `.vsix`
from this branch, install it, and sign in to a Viya profile, but do not
connect yet.

**Set up**, after 13.43. Run this as a selection from any local `.py` file
(**Python on Viya: Run Selection**). It makes `/tmp/sv-test` with three files:

```python
import os
os.makedirs("/tmp/sv-test", exist_ok=True)
for name, text in [(".hidden", "x
"), ("a b é.py", "print('hi')
"), ("x;y~z#q.py", "print(1)
")]:
    with open(os.path.join("/tmp/sv-test", name), "w") as f:
        f.write(text)
```

- [x] **13.43** **Not connected.** Open the **Python on Viya** activity bar.
  **Expect:** a **SAS Server** view below **SAS Content**, showing
  *Connect to SAS Viya to browse files on the SAS server through your
  session.* with a **Connect** button, and no session started (no
  `Connecting` line in **Python on Viya: Output**). Press **Connect**.
  **Expect:** the view shows **Home**, expanded, folders first.
- [x] **13.44** **Browsing and Copy Path.** Run the set-up above, then press
  the view's refresh button. Expand **tmp**, then **sv-test**. **Expect:**
  `a b é.py` and `x;y~z#q.py`, and no `.hidden`. Hover over `sv-test`.
  **Expect:** the tooltip `/tmp/sv-test`. Right-click it → **Copy Path**,
  and paste into an editor. **Expect:** `/tmp/sv-test`. **Copy Path** is
  not in the Command Palette.
- [x] **13.45** **Hidden files.** Turn on
  `pythonOnViya.sasServer.showHiddenFiles` in Settings. **Expect:** the
  tree refreshes by itself, and `.hidden` appears in `sv-test`. Turn it
  off again: it disappears.
- [x] **13.46** **Open, edit, save, run.** Click `a b é.py`. **Expect:** a
  tab titled `a b é.py` showing `print('hi')`. Add a line `print('saved')`
  and save. Close the tab, then click the file in the tree again.
  **Expect:** both lines. With that editor active, **Python on
  Viya: Run File**. **Expect:** `hi` and `saved` in the output. Repeat the edit and
  save on `x;y~z#q.py`. **Expect:** it saves, and reopens with the edit.
- [x] **13.47** **Changed on the server.** Open `a b é.py` and type a line
  without saving. From a local `.py` file, run as a selection:
  `open("/tmp/sv-test/a b é.py", "w").write("changed")`. Now save
  the server file's editor. **Expect:** the save fails with 
  *"/tmp/sv-test/a b é.py" changed on the SAS server since you opened it. ...*, and the
  file on the server is unchanged: close the tab without saving, reopen it,
  and it shows `changed`.
- [x] **13.48** **During a run.** From a local `.py` file, **Run File** on
  `import time; time.sleep(30)`. While it runs, collapse and expand
  **sv-test**, then open `x;y~z#q.py`, add a line and save. **Expect:** the
  tree lists at once and the save succeeds, both before the run ends.
- [x] **13.49** **A custom root.** In `settings.json`, add
  `"fileNavigationRoot": "CUSTOM", "fileNavigationCustomRootPath": "/tmp/sv-test"` to the profile. **Expect:** the view's top folder is
  `sv-test`, holding the two files. Change the path to `/tmp/sv-nope`.
  **Expect:** one warning row reading *The files cannot be accessed from
  "/tmp/sv-nope", the root folder set in your connection profile. Check
  fileNavigationCustomRootPath.* Click it after changing the path back.
  **Expect:** `sv-test` again. Then set `"fileNavigationRoot": "custom"`
  (lower case). **Expect:** `settings.json` underlines the value, and the
  **Python on Viya** output channel (the log, not **Python on Viya:
  Output**) warns *Ignoring profile "…": fileNavigationRoot must be USER,
  SYSTEM or CUSTOM*, naming the profile. The profile is not loaded, as
  `docs/connection-profiles.md` says. If it is your only profile, the SAS
  Content, SAS Server, SAS Libraries and CAS views all show their *add a
  connection profile* message. Change it back to `CUSTOM`. **Expect:** the
  views return.
  Remove both fields.
- [x] **13.50** **Saving after the session ends.** This needs a folder you
  can write to that outlives a session; `/tmp` may not, because each
  session can run on its own server. Find one (look under **Home** for a
  shared or mounted folder) and make a file in it the same way as the
  set-up. Open it from the tree and type a line without saving. Run
  **Python on Viya: Disconnect from SAS Viya**. **Expect:** the view shows its
  **Connect** prompt. Save the editor. **Expect:** it fails with *Connect
  to SAS Viya to open or save files on the SAS server.* Press **Connect**
  in the view, then save again. **Expect:** it saves, and the file reopens with the
  line. Delete the file afterwards.
- [x] **13.51** **Next to the SAS extension.** Only if the SAS extension
  is installed: with both enabled, reload the window. **Expect:** both
  extensions activate, and this view and the SAS extension's **SAS Server**
  view each list files. A file opened from this view has a tab whose
  editor does not show the SAS extension's run button.
- [x] **13.52** **Clean up.** Run as a selection:
  `import shutil; shutil.rmtree("/tmp/sv-test")`. Press refresh.
  **Expect:** `sv-test` is gone from **tmp**.
- [x] **13.53** **Compare with Saved, then save.** Added by the adversarial
  review: any read of a file replaces the tag its next save sends, so this
  checks that VS Code's own check still stops the overwrite. Run as a
  selection: `open("/tmp/sv-cmp.py", "w").write("print(1)")`. Press
  refresh, expand **tmp** and open `sv-cmp.py`. Type a line without saving.
  Run as a selection: `open("/tmp/sv-cmp.py", "w").write("changed")`.`
  With the server file's editor active, run **File: Compare Active File
  with Saved**. **Expect:** the saved side shows `changed`. Close the diff
  and save the editor. **Expect:** the save does not go through: VS Code
  says the file's content is newer, or the save fails with *changed on the
  SAS server since you opened it*. Do not choose **Overwrite**. Close the
  tab without saving and reopen it. **Expect:** `changed`. Clean up: run
  `import os; os.remove("/tmp/sv-cmp.py")`.

## 13p-ii — the SAS Server view: changing files

See `docs/phases/phase-13.md`'s "13p-ii built" Runbook entry.

**Before you start**

1. Build a `.vsix` from this branch, install it, sign in and connect.
2. On your computer, make a folder holding two small text files, `up1.txt`
   and `up2.txt`. 13.59 uploads them.
3. Open any local `.py` file, paste the code below, select it, and run
   **Python on Viya: Run Selection**. It makes `/tmp/sv2` holding `a.py`
   and a folder `sub` with `b.txt` inside.

   ```python
   import os
   os.makedirs("/tmp/sv2/sub", exist_ok=True)
   open("/tmp/sv2/a.py", "w").write("print('a')\n")
   open("/tmp/sv2/sub/b.txt", "w").write("b\n")
   ```

4. In the SAS Server view, press the refresh button, then expand `tmp`,
   then `sv2`.

The items below run in order; each one starts from where the last one
left off.

### 13.54 — Menus

- [x] **13.54** Each item's right-click menu shows only what applies to it.

1. Right-click `Home`.
   - Expect: Download... and Copy Path only. No New Folder, New File,
     Upload Files..., Rename or Delete (the top folder is read-only).
2. Right-click `sv2`.
   - Expect: all seven: New Folder, New File, Upload Files...,
     Download..., Copy Path, Rename, Delete.
3. Right-click `a.py`.
   - Expect: Download..., Copy Path, Rename and Delete only.
4. Open the Command Palette and type `SAS Server`.
   - Expect: none of the new commands are listed.

### 13.55 — New Folder and New File

- [x] **13.55** New items are created, and a bad name is refused.

1. Right-click `sv2` → New Folder. Type `made`, press Enter.
   - Expect: `made` appears inside `sv2`.
2. Right-click `sv2` → New File.
   - Expect: the box shows `untitled.py`, with `untitled` selected.
3. Type `n.py`, press Enter.
   - Expect: `n.py` appears inside `sv2`.
4. Click `n.py`.
   - Expect: an empty editor opens.
5. Right-click `sv2` → New Folder. Type `made` again, press Enter.
   - Expect: an error: `"/tmp/sv2/made" already exists on the SAS server`.
6. Right-click `sv2` → New Folder. Type `a/b`.
   - Expect: the box says *A name cannot contain "/".* and Enter does
     nothing.
7. Press Escape.

### 13.56 — Rename

- [x] **13.56** Files and folders rename, and a taken name is refused.

1. Right-click `a.py` → Rename.
   - Expect: the box selects `a`, not `.py`.
2. Type `a2.py`, press Enter.
   - Expect: the tree shows `a2.py`.
3. Right-click `a2.py` → Rename. Type `made`, press Enter.
   - Expect: an error saying it already exists. `a2.py` is unchanged.
4. Right-click `sub` → Rename. Type `sub2`, press Enter. Expand `sub2`.
   - Expect: `b.txt` is inside.

### 13.57 — Move by dragging

- [x] **13.57** Dragging onto a folder moves items there; a drop that makes
  no sense does nothing.

1. Drag `a2.py` onto `made`.
   - Expect: `a2.py` is now inside `made`.
2. Drag `sub2` onto `made`.
   - Expect: `sub2` is now inside `made`, with `b.txt` still inside it.
3. Drag `made` onto `made/sub2` (a folder inside itself).
   - Expect: nothing happens, and no error.
4. Drag `n.py` onto `sv2` (the folder it is already in).
   - Expect: nothing happens, and no error.
5. Drag `Home` onto `made` and drop it there.
   - Expect: VS Code still shows `Home` being dragged (its tree API cannot
     stop a drag from starting), but the drop does nothing: no move, no
     error, and `Home` is still the top folder with everything in place.
   **(10/1/2026) fail** home drags. I was too afraid to actually drop it onto anything.
   **Rewritten 2026-10-01:** the old expectation ("it does not drag") was
   one VS Code cannot meet. Re-run this step.
6. Expand `made/sub2`. Click `sub2`, then Ctrl+click `b.txt` inside it, so
   both are selected. Drag them onto `sv2`.
   - Expect: `sub2` moves into `sv2` with `b.txt` still inside it, and no
     error appears.
7. Drag `sub2` back onto `made`.
   - Expect: `sub2` is inside `made` again.

### 13.58 — Delete

- [x] **13.58** Delete asks first, and removes a folder with its contents.

1. Right-click `n.py` → Delete.
   - Expect: a dialog *Permanently delete "n.py"?* that says the server has
     no recycle bin.
2. Press Cancel.
   - Expect: `n.py` is still there.
3. Right-click `n.py` → Delete, and choose Delete Permanently.
   - Expect: `n.py` is gone.
4. Right-click `made` → Delete.
   - Expect: the dialog says the folder goes *and everything inside it*.
5. Choose Delete Permanently.
   - Expect: `made` is gone. `sv2` is now empty.

### 13.59 — Upload

- [x] **13.59** Files upload, and a name already taken is refused.

1. Right-click `sv2` → Upload Files.... Pick `up1.txt` and `up2.txt`.
   - Expect: the message *Uploaded 2 files to "sv2".* Both files appear.
2. Click `up1.txt`.
   - Expect: its content matches your local copy.
3. Right-click `sv2` → Upload Files.... Pick `up1.txt` only.
   - Expect: the error *Could not upload "up1.txt". "/tmp/sv2/up1.txt"
     already exists on the SAS server. Choose another name.* The file on
     the server is unchanged.

### 13.60 — Download

- [x] **13.60** A folder and a file download, and an existing file is not
  overwritten without asking.

1. Right-click `sv2` → Download.... Pick an empty local folder.
   - Expect: the message *Downloaded 2 files from "sv2".* with a Show in
     Folder button.
2. Look in the local folder.
   - Expect: a folder `sv2` holding `up1.txt` and `up2.txt`, the same
     content as the originals.
3. Right-click `up1.txt` → Download.... Pick the same local folder.
   - Expect: a file `up1.txt` appears beside the `sv2` folder.
4. Download `up1.txt` into the same local folder again.
   - Expect: a dialog asking whether to replace it.

### 13.61 — Changes while code is running

- [x] **13.61** Changing files doesn't wait for a running program.

1. In a local `.py` file, put `import time; time.sleep(30)` and run
   **Python on Viya: Run File**.
2. While it runs, right-click `sv2` → New Folder, and type `busy`.
   - Expect: `busy` appears at once.
3. Still while it runs, rename `busy` to `busy2`.
   - Expect: the rename happens at once.
4. Still while it runs, delete `busy2`.
   - Expect: it is gone at once, before the run ends.

### 13.62 — Clean up

- [x] **13.62** Remove what these tests made.

1. Run this as a selection: `import shutil; shutil.rmtree("/tmp/sv2")`.
2. Press the SAS Server view's refresh button.
   - Expect: `sv2` is gone from `tmp`.
3. Delete the local folder you downloaded into in 13.60.

## 13g — a trailing DataFrame is a sortable grid

See `docs/phases/phase-13.md`'s "13g built" Runbook entry and ADR-0048.

**Set-up, once.**

1. Build a `.vsix` from this branch, install it, and reload the window.
2. Sign in to a Viya profile.
3. Check that `pythonOnViya.notebook.dataFrameGrid.maxRows` is `100` and
   `pythonOnViya.notebook.dataFrameGrid.maxColumns` is `20`, the defaults.
4. Create `grid-test.ipynb` and pick the **Python on Viya** kernel.

Run the items in order, each in a new cell of `grid-test.ipynb` unless the
item says otherwise.

### 13.63 — A small DataFrame

- [x] **13.63** A trailing DataFrame shows as a sortable grid.

1. Run a cell holding:

   ```python
   import pandas as pd
   df = pd.DataFrame({"a": [3, 1, 2], "b": ["x", "z", "y"]})
   ```

   - Expect: no output.
2. Run a cell holding only `df`.
   - Expect: a grid, not an HTML table.
   - Expect: the index column first, in bold, then `a`, then `b`.
   - Expect: above the grid, the line *Rows: 3 · Columns: 2*.
3. Run **Developer: Toggle Developer Tools** and open its **Console** tab.
   - Expect: no error mentioning ag-grid.
4. Click the `a` header.
   - Expect: `a` reads 1, 2, 3.
5. Click the `a` header again.
   - Expect: `a` reads 3, 2, 1.
6. Click the `b` header.
   - Expect: `b` reads x, y, z.

  **(10/1/2026) fail** nothing in the developer tab at all. 

### 13.64 — The theme

- [x] **13.64** The grid follows VS Code's colour theme.

1. Keep the 13.63 grid in view. Run **Preferences: Color Theme** and pick
   a light theme.
   - Expect: the grid's background, text, borders and header turn light,
     and the text is readable.
2. Pick a dark theme.
   - Expect: the same, dark.
3. Pick a high-contrast theme.
   - Expect: the same, high-contrast.
4. Switch back to your usual theme.

### 13.65 — Change Presentation

- [x] **13.65** The HTML table is one menu away.

1. Hover over the 13.63 output, open its **...** menu and choose **Change
   Presentation**.
   - Expect: the list offers the grid and `text/html`.
2. Choose `text/html`.
   - Expect: the HTML table that 13f showed.
3. Open **Change Presentation** again and choose the grid.
   - Expect: the grid is back.

### 13.66 — The size settings

- [x] **13.66** The two settings set how much is shown, and 0 turns the
      grid off.

1. Run a cell holding:

   ```python
   wide = pd.DataFrame([[r * 100 + c for c in range(30)] for r in range(250)])
   wide
   ```

   - Expect: a grid of 100 rows and 20 columns. Scroll to check.
   - Expect: the line *Rows: first 100 of 250 · Columns: first 20 of 30 ·
     sorting applies to the rows shown*.
2. Set `maxRows` to `250` and `maxColumns` to `30`. Re-run the cell.
   - Expect: all 250 rows and 30 columns.
   - Expect: the line *Rows: 250 · Columns: 30*.
3. Set `maxRows` to `0`. Re-run the cell.
   - Expect: no grid; an HTML table.
4. Set `maxRows` back to `100` and `maxColumns` back to `20`.

### 13.67 — Dates and times on Viya

- [x] **13.67** Date, time-zone and duration columns show in the grid.

1. Run a cell holding:

   ```python
   t = pd.DataFrame({
       "naive": pd.to_datetime(["2026-01-02 03:04:05.123456789", None]),
       "zoned": pd.to_datetime(["2026-01-02 03:04:05", None]).tz_localize("America/New_York"),
       "delta": pd.to_timedelta(["1 days 02:03:04", None]),
   })
   t
   ```

   - Expect: a grid, with no line saying the grid could not be built.
   - Expect: `naive` shows `2026-01-02 03:04:05.123456789`, all nine
     digits.
   - Expect: `zoned` shows `2026-01-02 03:04:05-05:00`.
   - Expect: `delta` shows `1 days 02:03:04`.
   - Expect: the missing values read `NaT` in `naive` and `zoned`, and
     `None` in `delta`.
2. Click the `naive` header.
   - Expect: the `NaT` row comes first.
3. Note what you saw in the 13g Runbook entry, even if it all passed:
   Finding 13.35 left a similar frame unexplained.

### 13.68 — Rows left out

- [x] **13.68** Sorting covers only the rows shown, and the line says so.

1. Run a cell holding:

   ```python
   big = pd.DataFrame({"n": range(1500, 0, -1)})
   big
   ```

   - Expect: the line ends *sorting applies to the rows shown*.
2. Click the `n` header.
   - Expect: the first row is `1401`, not `1`.

### 13.69 — The interactive window

- [x] **13.69** The grid shows in the interactive window too.

1. Open a new `.py` file holding:

   ```python
   import pandas as pd
   pd.DataFrame({"a": [2, 1]})
   ```

2. Select both lines. Run **Run Selection in Interactive Window**.
   - Expect: the interactive window opens and shows a grid with `a`
     reading 2, 1.
3. Click the `a` header.
   - Expect: `a` reads 1, 2.
4. Close the `.py` file without saving.

### 13.70 — Numbers too large for JavaScript

- [x] **13.70** Big integers, infinities and `NaN` show and sort by value.

1. Run a cell holding:

   ```python
   import numpy as np
   n = pd.DataFrame({
       "i": [9007199254740993, 9007199254740992, -4611686018427387904],
       "f": [np.inf, np.nan, -np.inf],
   })
   n
   ```

   - Expect: `i` shows `9007199254740993` and `9007199254740992`, each
     exactly. They are not rounded to the same number.
   - Expect: `f` shows `inf`, `NaN` and `-inf`.
2. Click the `i` header.
   - Expect: `-4611686018427387904`, then `9007199254740992`, then
     `9007199254740993`.
3. Click the `f` header.
   - Expect: `NaN`, then `-inf`, then `inf`.

### 13.71 — What is not a grid

- [x] **13.71** A Series, a Styler and a hidden value are not grids.

1. Run a cell holding only `df["a"]`.
   - Expect: the Series as plain text, not a grid.
2. Run a cell holding only `df.style`.
   - Expect: a styled HTML table, not a grid.
3. Run a cell holding only `df;`.
   - Expect: no output.

### 13.72 — Fallbacks

- [x] **13.72** A grid that cannot be built falls back, and a long label
      is cut.

1. Run a cell holding:

   ```python
   class Odd(pd.DataFrame):
       def _repr_html_(self):
           raise RuntimeError("boom")
   Odd({"a": [1]})
   ```

   - Expect: the line *The DataFrame grid could not be built:
     RuntimeError('boom'); showing the value another way.*
   - Expect: the line *Odd._repr_html_() raised RuntimeError('boom');
     showing the value another way.*
   - Expect: the frame as plain text.
2. Set `maxColumns` to `200`. Run a cell holding:

   ```python
   pd.DataFrame([["x" * 1000] * 200] * 100)
   ```

   - Expect: a line saying the grid could not be built because it is
     larger than 10485760 bytes.
   - Expect: an HTML table under it.
3. Set `maxColumns` back to `20`.
4. Run a cell holding:

   ```python
   pd.DataFrame([[1]], columns=pd.MultiIndex.from_tuples([("a" * 900, "b" * 900, "c" * 900)]))
   ```

   - Expect: a grid, not a line saying a rich output file could not be
     retrieved.
   - Expect: the one column header ends in `…`. Widen the column or hover
     over the header to see the end.

### 13.73 — A saved notebook

- [x] **13.73** A saved notebook keeps both the grid and the HTML.

1. Save `grid-test.ipynb`.
2. Run **View: Reopen Editor With...** and choose **Text Editor**.
3. Search for `dataframe+json`.
   - Expect: the 13.63 output holds both
     `application/vnd.python-on-viya.dataframe+json` and `text/html`.
4. If Jupyter or a GitHub preview is to hand, open the file there.
   - Expect: the HTML tables, no grids.
   - If neither is to hand, note that in the 13g Runbook entry.

### 13.74 — A hand-edited payload

- [x] **13.74** A broken grid in a saved notebook shows an error, not a
      blank.

1. In the text view from 13.73, find the 13.63 output's `"format": 1` and
   change it to `"format": 2`. Save.
2. Run **View: Reopen Editor With...** and choose the notebook editor.
   - Expect: the 13.63 output shows a rendering error, not a grid.
   - Expect: every other output looks as before.
3. Open that output's **Change Presentation**.
   - Expect: `text/html` is offered and shows the table.
4. Close the notebook and delete `grid-test.ipynb`.

## 13c — the Commands view

See `docs/phases/phase-13.md`'s "13c built" Runbook entry.

**Set-up, once.**

1. Build a `.vsix` from this branch, install it, and reload the window.
2. Have at least one connection profile, and start signed out and not
   connected (**Sign Out** from the palette if need be).
3. Open a folder holding a short `.py` file, say `hello.py` with
   `print("hello")`, and open it in an editor.

### 13.75 — Where it is and what it shows

- [x] **13.75** The view is first in the sidebar, with three groups and
      Show Log.

1. Click the **Python on Viya** icon in the activity bar.
   - Expect: **Commands** is the first view, above **SAS Content**.
   - Expect: three expanded groups, **Connection**, **Run** and
     **Snippets**, then **Show Log** on its own.
   - Expect: every entry has an icon, and its label matches the palette
     entry of the same name, without the "Python on Viya:" prefix.
2. Look at **Connection**.
   - Expect: **Sign In**, **Connect to SAS Viya**, **Switch Connection
     Profile**, **Add Connection Profile**. No **Disconnect from SAS Viya**.
3. Look at **Run**.
   - Expect: **Run File**, **New Interactive Window**, **Reset Python
     State**, **Select Run Target**, **Refresh CAS Token**. No **Cancel**.
4. Look at **Snippets**.
   - Expect: **Insert CAS Connection Snippet**, **Insert CAS SQL
     Passthrough Snippet**.

### 13.76 — Connection follows the state

- [x] **13.76** Sign In, Connect and Disconnect come and go with the
      state, however it changes.

1. Click **Sign In** in the view and finish signing in.
   - Expect: **Sign In** leaves the Connection group; **Connect to SAS
     Viya** stays.
2. Click **Connect to SAS Viya**.
   - Expect: the usual "Connected to SAS Viya" message, and **Connect to
     SAS Viya** turns into **Disconnect from SAS Viya**.
3. Run **Python on Viya: Disconnect from SAS Viya** from the palette, not
   the view.
   - Expect: the view shows **Connect to SAS Viya** again.
4. Collapse the **Run** group, then click **Connect to SAS Viya**.
   - Expect: **Run** stays collapsed after the view changes.
5. Run **Python on Viya: Sign Out** from the palette.
   - Expect: **Sign In** is back in the Connection group.
6. If you have a second connection profile, sign in with the first, then
   **Switch Connection Profile** to the second. Otherwise skip to step 8.
   - Expect: no **Sign In** in the view: it hides Sign In while any
     account is signed in, as the welcome views do.
7. Click **Connect to SAS Viya**.
   - Expect: you are asked to sign in to the second profile, then
     connected. Switch back to the first profile afterwards.
8. Sign in and connect again for the items below.

### 13.77 — Run and Cancel

- [x] **13.77** Run File runs the open file, and Cancel shows only while
      it runs.

1. With `hello.py` the active editor, click **Run File** in the view.
   - Expect: the run happens as it does from the editor's Run button, and
     `hello` appears in **Python on Viya: Output**.
   - Expect: no **Cancel** in the Run group once it ends.
2. Change `hello.py` to:

   ```python
   import time
   time.sleep(30)
   ```

   Click **Run File** in the view.
   - Expect: **Cancel** appears in the Run group, after **New Interactive
     Window**, while it runs.
3. Click **Cancel** in the view.
   - Expect: the run is cancelled, as from the palette, and **Cancel**
     leaves the group.
4. Click **Run File** again and let it finish.
   - Expect: **Cancel** appears, then leaves when the run ends by itself.

### 13.78 — Every other entry

- [x] **13.78** Each entry does what its palette entry does.

With `hello.py` the active editor, click each in turn:

1. **New Interactive Window**. Expect: an interactive window opens.
2. **Reset Python State**. Expect: the usual reset message.
3. **Select Run Target**. Expect: the run-target picker; press Escape.
4. **Switch Connection Profile**. Expect: the profile picker; press
   Escape.
5. **Add Connection Profile**. Expect: the first step of the add-profile
   prompts; press Escape.
6. **Insert CAS Connection Snippet**, with the cursor on an empty line of
   `hello.py`. Expect: the snippet is inserted at the cursor, as from the
   palette.
7. **Insert CAS SQL Passthrough Snippet**. Expect: the same as from the
   palette.
8. **Refresh CAS Token**. Expect: the same message as from the palette.
9. **Show Log**. Expect: the **Python on Viya** output channel opens.
10. Undo the snippet insertions and close the interactive window.

### 13.79 — With no profile

- [x] **13.79** With no connection profile, Connection offers only Add
      Connection Profile.

1. Create a new VS Code profile (**Profiles: New Profile...**, empty, not
   copied from yours), install the `.vsix` in it, and open the **Python
   on Viya** sidebar.
   - Expect: **Connection** holds only **Add Connection Profile**; **Run**
     and **Snippets** are as in 13.75.
2. Click **Add Connection Profile** and add a profile (any endpoint will
   do).
   - Expect: **Sign In**, **Connect to SAS Viya**, **Switch Connection
     Profile** and **Add Connection Profile** appear.
3. Switch back to your own VS Code profile and delete the new one.

### 13.80 — An untrusted folder

- [x] **13.80** In an untrusted folder, Sign In and Connect explain
      themselves.

1. Run **Workspaces: Manage Workspace Trust** and mark this folder
   untrusted (or open a new, untrusted folder). Disconnect and **Sign
   Out** first.
2. Click **Connect to SAS Viya** in the view.
   - Expect: a message that connecting needs a trusted folder, not
     silence.
3. Click **Sign In** in the view.
   - Expect: the same "requires a trusted folder" message, not silence.
4. Trust the folder again.

## 13d — the snippet library

See `docs/phases/phase-13.md`'s "13d built" Runbook entry.

**Set-up, once.**

1. Build a `.vsix` from this branch, install it, and reload the window.
2. Sign in and connect.
3. Open a folder and create an empty `snippets.py` in it.

### 13.81 — Typing a prefix

- [x] **13.81** Every snippet is offered by its `viya-` prefix, and its
      placeholders work.

1. In `snippets.py`, type `viya`.
   - Expect: the suggestions include all twelve `viya-` snippets (scroll
     if need be), each marked as a snippet.
2. Choose `viya-sql-read`.
   - Expect: the PROC SQL view snippet, with `work.filtered` selected.
3. Type `work.teens`.
   - Expect: the `SAS.sd2df("...")` line at the bottom changes to
     `work.teens` as you type.
4. Press Tab four times.
   - Expect: the selection moves to `*`, `sashelp.class`, `age > 13`, then
     `filtered_df`.
5. Press Escape, then run the file (**Run File**).
   - Expect: the run succeeds. Add `print(filtered_df.shape)` and run
     again: `(9, 5)`.

### 13.82 — Insert Viya Snippet

- [x] **13.82** The command lists only this extension's snippets, from the
      palette and from the Commands view.

1. Run **Python on Viya: Insert Viya Snippet...** from the palette.
   - Expect: a picker of the twelve snippets, each with its prefix and a
     one-line description, and nothing else.
2. Type `macro`.
   - Expect: the list narrows to the two macro-variable snippets (the
     match is on the descriptions too).
3. Choose **Read a macro variable**.
   - Expect: `value = SAS.symget("name")` at the cursor, `value` selected.
4. Open the **Commands** view.
   - Expect: **Insert Viya Snippet...** is first in the **Snippets** group,
     above the two CAS snippet commands.
5. Click it, then press Escape.
   - Expect: the same picker; Escape inserts nothing.
6. Open a Markdown file and click it again.
   - Expect: "Open a Python file first, then run this command again."

### 13.83 — The run-and-check snippets

- [x] **13.83** `viya-submit`, `viya-symput`/`viya-symget` and
      `viya-log-warning` behave as their descriptions say.

1. Replace `snippets.py`'s contents with the `viya-submit` snippet, leaving
   its placeholder as is, and run it.
   - Expect: the run succeeds, with no traceback.
2. Change the SAS code to `data work.x; set work.nosuch; run;` and run it.
   - Expect: the run fails, with an `ERROR:` line for `WORK.NOSUCH` and a
     traceback ending in `RuntimeError: SAS step failed: SYSERR=1012`.
3. Change the SAS code to
   `options syntaxcheck; data work.x; set work.nosuch; run; data work.y; run;`
   and run it.
   - Expect: the run fails, with a traceback ending in
     `RuntimeError: SAS step failed: SYSERR=3`: the second step only
     checked its syntax, and the snippet does not pass that.
4. Replace the contents with a `viya-symput` snippet setting `n` to `42`,
   then a `viya-symget` snippet reading `n` into `value`, then
   `print(repr(value))`. Run it.
   - Expect: `'42'` in the output.
5. Add a `viya-log-warning` snippet with the message `hello` and run.
   - Expect: `WARNING: Python-Subprocess - hello` in the output.

### 13.84 — Showing output, and CAS

- [x] **13.84** The show snippets reach the Result panel, and the CAS
      snippets round-trip a table.

1. Replace the contents with `viya-show-figure`, leaving its placeholders,
   and run it.
   - Expect: the Result panel shows a line plot.
2. Replace the contents with `df = SAS.sd2df("sashelp.class")`, then a
   `viya-show-df` snippet. Run it.
   - Expect: the Result panel shows the 19-row table.
3. Run **Insert CAS Connection Snippet**, then add the line
   `import pandas as pd; df = pd.DataFrame({"a": [1, 2]})`, a
   `viya-cas-upload` snippet, then a `viya-cas-read` snippet, then
   `print(df)` and `conn.close()`. Run it (run **Refresh CAS Token**
   first if asked).
   - Expect: the run succeeds and prints the two-row frame read back from
     CAS.

### 13.85 — The credential snippet keeps the password out of the log

- [x] **13.85** `viya-libname-secret` never shows the password, and
      reports a failed `libname`.

1. Replace the contents with:

   ```python
   SAS.submit("options symbolgen;")
   ```

   then a `viya-libname-secret` snippet. Change its second placeholder
   from `os.environ["DB_PASSWORD"]` to `"not-a-real-password"`, and its
   host to `nohost.invalid`. Leave the rest. Run it.
   - Expect: an `ERROR: Error in the LIBNAME statement.` line, then a
     traceback ending in `RuntimeError: LIBNAME failed: SYSLIBRC=` and a
     non-zero number.
   - Expect: `not-a-real-password` appears nowhere in the output, not even
     in a `SYMBOLGEN:` line.
2. Run **Python on Viya: Show Log** and search it for
   `not-a-real-password`.
   - Expect: no match.
3. Undo the edit and close `snippets.py` without saving.

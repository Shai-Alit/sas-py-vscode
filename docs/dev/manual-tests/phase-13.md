<!-- Copyright © 2026, Sean Ford and the Python on Viya contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Manual test pass — Phase 13 (Feature completion)

See [`setup.md`](setup.md) for pre-flight/activation and the tagging legend.

> Renumbered from Phase 12 to Phase 13, 2026-09-22 — see
> `docs/phases/phase-13.md`'s own provenance note.

Add numbered items here (`13.1`, `13.2`, …) as slices land, the same way
every other phase file did.

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

# Claude Code access

Python on Viya can run a small MCP server that the Claude Code command-line
tool connects to. In this release the server has no tools yet: Claude Code
can connect to it, but cannot browse or run anything through it. The
read-only library and CAS tools come in a later release. This page covers
turning the server on, registering it, and what protects it.

For guidance that helps an agent write Python for Viya, see the
[AI agent skill](agent-skill.md). The skill and the server are separate, and
either works without the other.

## Before you start

- **Claude Code** installed, with `claude` on your `PATH`.
- **A folder open in VS Code.** The server keeps its port and secret with
  the folder, and Claude Code registers it for one folder.
- **A trusted workspace.** The server never starts in Restricted Mode.

## Set it up

1. Run **Python on Viya: Set Up Claude Code Access** from the Command
   Palette.
2. If the server is off, which it is by default, the command asks whether to
   turn it on. **Turn On** sets `pythonOnViya.agentServer.enabled` in your
   user settings, so it applies to every trusted folder you open. Settings
   Sync carries it to your other machines.
3. The command copies a command line that registers the server with Claude
   Code, quoted for your default terminal shell: bash or zsh (Git Bash
   included), Command Prompt, or PowerShell. **Paste into a New Terminal**
   opens a terminal in the folder and pastes the line without running it.
   Press Enter to run it.
4. Start `claude` in the same folder. If Claude Code asks whether to trust
   the folder, accept: until you do, it does not fetch the server's secret.
5. In Claude Code, run `/mcp`. **python-on-viya** is listed as connected.

The line removes any earlier `python-on-viya` registration for the folder
first, so running the command again is safe. The removal prints nothing when
there is none.

## Reloads and restarts

The server makes a new secret every time it starts, including after
**Developer: Reload Window**. You do not need to register again. Claude Code
reads the secret through a command stored in the registration, and runs that
command again when it reconnects.

The port stays the same from one start to the next. If another program has
taken it in the meantime, the server moves to a free port and a notification
asks you to register again. **Register Again** runs the setup command. Until
you do, Claude Code cannot reach the server.

## Turning it off

Set `pythonOnViya.agentServer.enabled` to `false`. The server stops at once,
and its secret file is deleted. The Claude Code registration stays, and
shows as failing to connect until you turn the server back on. To remove it,
run `claude mcp remove --scope local python-on-viya` in the folder.

## How it is protected

- **Your machine only.** The server listens on `127.0.0.1` and cannot be
  reached from the network. In a remote window (SSH, WSL, a container or
  Codespaces) it runs on the remote machine instead, and VS Code may forward
  its port to yours. The secret still applies. To stop the forwarding, set
  `"remote.portsAttributes": { "<port>": { "onAutoForward": "ignore" } }`
  with the server's port.
- **A secret for each start.** Every request must carry a secret the server
  makes when it starts. The secret is 32 random bytes, unrelated to your
  Viya sign-in. It is kept in memory and in a file in this folder's private
  extension storage, under your user profile. On macOS and Linux only you
  can read the file; on Windows it has the same access as the rest of your
  VS Code data. The file is deleted when the server stops.
- **No web pages.** The server refuses any request that a browser page could
  send, whatever address the page used to reach it.
- **Trusted folders only.** A folder's own settings cannot turn the server on
  until you trust the folder.
- **Nothing sensitive in the log.** The **Python on Viya** output channel
  records when the server starts and stops. At the **Debug** log level it
  also records the status of any refused request. It never records the
  secret or a request's headers.

## If it does not connect

- **"cannot be registered from this folder"**: the path to the folder's
  extension storage contains a `%`, `!` or `"`, which the Windows command
  shell would change. The **Python on Viya** output channel shows the path.
- **`/mcp` shows it failing after the port moved**: register again, as above.
- **The server did not start**: the **Python on Viya** output channel says
  why.

See [ADR-0042](adr/0042-a-local-mcp-server-for-claude-code.md) for the design
and the alternatives that were considered.

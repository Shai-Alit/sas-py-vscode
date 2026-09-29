// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The command line that registers the agent server with Claude Code, and the
 * `headersHelper` inside it. ADR-0042.
 *
 * **This module must never import `vscode` or a Node built-in.** Everything
 * here is string-building whose mistakes are shell-injection shaped, so all of
 * it belongs in the unit tier.
 *
 * **The helper reads a file; it is not a script.** Claude Code runs a
 * `headersHelper` through a shell on every connection and merges the JSON it
 * prints into the request headers. On Windows that shell is
 * `cmd.exe /d /s /c "<command>"` whatever the user's own shell is (probe (b),
 * "12o built"), so the helper is `type "<file>"` there and `cat '<file>'`
 * elsewhere. The file holds this server start's secret (`./headersFile`), so
 * a helper that re-reads it picks up a new secret after a window reload
 * without the user registering again.
 *
 * **The registration line is quoted for the shell it will be pasted into.**
 * `claude mcp add-json` takes the server's JSON as one argument, and JSON is
 * full of double quotes, which each shell passes on differently. The forms
 * below were each run on 2026-09-28 through an npm-style `claude.cmd` shim,
 * with a space in the helper's path, and arrived intact: a POSIX single-quoted
 * argument (Git Bash); a Microsoft C runtime–quoted one for `cmd.exe`; and,
 * for Windows PowerShell 5.1, the `cmd.exe` form wrapped in `cmd /c '…'`.
 * The wrapper is what makes PowerShell safe: 5.1 drops embedded quotes when
 * it calls a native program, and 7.3+ passes them correctly except to
 * `cmd.exe` and batch files — which is what an npm-installed `claude` is — so
 * handing both versions a single string for `cmd.exe` is the one form that
 * behaves the same in each. PowerShell outside Windows has no such exception
 * and gets a plain single-quoted argument.
 *
 * **`remove` first.** `add-json` refuses a name that is already registered
 * (it exits 1 with "already exists"), and the registration has to be
 * replaced when the port changes. `remove` prints its "not found" to stderr,
 * which each form discards, and is chained so its failure does not stop
 * `add-json`.
 */

/** The name the server is registered under, and what `initialize` reports. */
export const AGENT_SERVER_NAME = "python-on-viya";

/** Which quoting a registration line needs. */
export type ShellKind = "posix" | "cmd" | "powershell";

/** The platforms this module distinguishes. Anything that is not Windows
 * quotes the POSIX way. */
export type HostPlatform = "win32" | "other";

/**
 * The shell a line will be pasted into, from VS Code's default terminal
 * shell (`vscode.env.shell`). Anything unrecognised — Git Bash, zsh, fish,
 * WSL — is treated as POSIX, which is what it is in every case this
 * extension expects to meet.
 */
export function shellKindFor(shellPath: string): ShellKind {
  const separator = Math.max(
    shellPath.lastIndexOf("/"),
    shellPath.lastIndexOf("\\"),
  );
  const base = shellPath.slice(separator + 1).toLowerCase();
  const name = base.endsWith(".exe") ? base.slice(0, -4) : base;
  if (name === "cmd") return "cmd";
  if (name === "powershell" || name === "pwsh") return "powershell";
  return "posix";
}

/**
 * The `headersHelper` command for a headers file, or `undefined` when the
 * path holds a character the helper's shell would interpret.
 *
 * On Windows that is `%` and `!` — `cmd.exe` expands variables inside double
 * quotes, and `!` too where delayed expansion is on — plus `"`, which no
 * Windows path can hold anyway. Every other character is literal between the
 * quotes. A control character is refused everywhere; no real storage path
 * has one.
 */
export function headersHelperCommand(
  filePath: string,
  platform: HostPlatform,
): string | undefined {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
  if (/[\u0000-\u001f\u007f]/.test(filePath)) return undefined;
  if (platform === "win32") {
    return /[%!"]/.test(filePath) ? undefined : `type "${filePath}"`;
  }
  return `cat ${posixQuote(filePath)}`;
}

/** The URL the server answers on. `127.0.0.1`, never `localhost`: the name
 * can resolve to `::1` first, where nothing is listening. */
export function agentServerUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}/mcp`;
}

/** The JSON `claude mcp add-json` stores for the server. */
export function registrationJson(port: number, helper: string): string {
  return JSON.stringify({
    type: "http",
    url: agentServerUrl(port),
    headersHelper: helper,
  });
}

/**
 * The line to paste into `shell`: remove any earlier registration, then add
 * this one at local scope — Claude Code's per-project scope, keyed by the
 * directory the command runs in, which is why the user runs it in the
 * workspace folder.
 */
export function registrationCommand(
  port: number,
  helper: string,
  shell: ShellKind,
  platform: HostPlatform,
): string {
  const json = registrationJson(port, helper);
  const remove = `claude mcp remove --scope local ${AGENT_SERVER_NAME}`;
  const add = `claude mcp add-json --scope local ${AGENT_SERVER_NAME}`;

  if (shell === "posix") {
    return `${remove} 2>/dev/null; ${add} ${posixQuote(json)}`;
  }
  const cmdLine = `${remove} 2>nul & ${add} ${crtQuote(json)}`;
  if (shell === "cmd") return cmdLine;
  if (platform === "win32") return `cmd /c ${powerShellQuote(cmdLine)}`;
  return `${remove} 2>$null; ${add} ${powerShellQuote(json)}`;
}

/** A single-quoted POSIX shell word. Nothing is special inside single quotes
 * except the quote itself, which is closed, escaped and reopened. */
export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** A single-quoted PowerShell string. Only a single quote is special, and it
 * is written twice — the curly ones too (U+2018 to U+201B), which PowerShell
 * also reads as single quotes (`about_Quoting_Rules`). */
export function powerShellQuote(value: string): string {
  return `'${value.replace(/['\u2018-\u201b]/g, "$&$&")}'`;
}

/**
 * One argument quoted the way the Microsoft C runtime — and so Node —
 * splits a Windows command line: a quote is escaped with a backslash, and
 * any backslashes directly before a quote, or before the closing one, are
 * doubled. The caller has already refused `%` and `!`, the only characters
 * `cmd.exe` would still act on.
 */
export function crtQuote(value: string): string {
  const escaped = value
    .replace(/(\\*)"/g, (_match, slashes: string) => `${slashes}${slashes}\\"`)
    .replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

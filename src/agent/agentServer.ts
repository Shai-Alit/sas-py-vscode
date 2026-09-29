// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The VS Code shell around the agent server: when it runs, where its port and
 * secret live, and the command that registers it with Claude Code.
 * ADR-0042.
 *
 * **When it runs.** Only when all three hold: the window has a folder open
 * (the port and the headers file are kept per workspace, and Claude Code's
 * registration is per project directory); the workspace is trusted
 * (ADR-0002 — the server is how an agent reaches this extension's Viya
 * access, so it starts no earlier than a connection could); and
 * `pythonOnViya.agentServer.enabled` is on. The setting is off by default and
 * listed in `restrictedConfigurations`, so an untrusted repository cannot
 * turn it on. Trust granted while the window is open, or the setting changed,
 * starts or stops it without a reload.
 *
 * **Its port.** The first start takes whatever port the OS offers and keeps
 * it in `workspaceState`; later starts ask for that one again, so a
 * registration survives a reload. Two windows on two folders hold two
 * different ports. If the port has been taken in the meantime the server
 * binds a new one, keeps that instead, and tells the user to register again.
 *
 * **Its secret.** New on every start (`./server`'s `createSecret`), held in
 * memory and in the headers file (`./headersFile`), which is removed when the
 * server stops. Neither the secret nor a request's headers are ever logged.
 * After a reload a registered client's next request is refused with `401`;
 * Claude Code then runs its `headersHelper` again, reads the new file, and
 * retries once.
 */

import * as vscode from "vscode";

import { removeHeadersFiles, writeHeadersFile } from "./headersFile";
import {
  AGENT_SERVER_NAME,
  agentServerUrl,
  headersHelperCommand,
  registrationCommand,
  shellKindFor,
  type HostPlatform,
  type ShellKind,
} from "./registration";
import {
  createSecret,
  preferredPort,
  startAgentServer,
  type AgentServer,
} from "./server";

/** `workspaceState`, never a setting: a port is this machine's, and a
 * repository must not choose it. */
const PORT_STATE_KEY = "pythonOnViya.agentServer.port";

const ENABLED_SETTING = "agentServer.enabled";

export const SET_UP_CLAUDE_CODE_COMMAND = "pythonOnViya.setUpClaudeCode";

type AgentServerLog = Pick<
  vscode.LogOutputChannel,
  "debug" | "info" | "warn" | "error"
>;

export interface AgentServerDeps {
  readonly workspaceState: vscode.Memento;
  /** `ExtensionContext.storageUri`'s path — `undefined` in a window with no
   * folder, which never starts the server. */
  readonly storageDirectory: string | undefined;
  /** What `initialize` reports as the server's version. */
  readonly version: string;
  readonly log: AgentServerLog;
  /**
   * Defaults to {@link vscode.workspace.isTrusted}. Injectable for the same
   * reason `ComputeSessionManagerDeps.isTrusted` is: the integration host's
   * empty window is always trusted, and a gate whose closed side never runs
   * is a comment.
   */
  readonly isTrusted?: (() => boolean) | undefined;
  /** Defaults to reading `pythonOnViya.agentServer.enabled`. */
  readonly isEnabled?: (() => boolean) | undefined;
  /** Told when a stored port could not be bound and a new one was kept, so
   * the user can register again. Not called on the first start. */
  readonly onPortChanged?:
    ((previous: number, port: number) => void) | undefined;
}

/** Why the server is not running, when it is not. */
export type AgentServerBlocker =
  "no-folder" | "untrusted" | "disabled" | "failed";

export type AgentServerStatus =
  | {
      readonly kind: "running";
      readonly port: number;
      readonly headersFile: string;
    }
  | { readonly kind: "off"; readonly reason: AgentServerBlocker };

interface Running {
  readonly server: AgentServer;
  readonly headersFile: string;
}

export class AgentServerController implements vscode.Disposable {
  private running: Running | undefined;
  private disposed = false;
  /** Every start and stop runs in order, so a setting flipped twice quickly
   * cannot start two servers. It never holds a rejection: one would stop
   * every later start and stop. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: AgentServerDeps) {}

  /** Starts or stops the server to match the folder, trust and the setting.
   * Resolves once that is done; never rejects — a failure is logged and
   * reported by {@link status}. */
  refresh(): Promise<void> {
    this.queue = this.queue
      .then(() => this.reconcile())
      .catch((error: unknown) => {
        this.deps.log.error(
          vscode.l10n.t(
            "The MCP server could not be started or stopped: {0}",
            describe(error),
          ),
        );
      });
    return this.queue;
  }

  status(): AgentServerStatus {
    if (this.running !== undefined) {
      return {
        kind: "running",
        port: this.running.server.port,
        headersFile: this.running.headersFile,
      };
    }
    return { kind: "off", reason: this.blocker() ?? "failed" };
  }

  dispose(): void {
    this.disposed = true;
    const running = this.running;
    this.running = undefined;
    if (running === undefined) return;
    // Synchronous, because nothing awaits a disposable: the secret's file is
    // gone before the window finishes closing. The socket closes on its own
    // schedule, and the process is ending anyway.
    this.removeHeadersFile();
    void running.server.close();
  }

  /** Read through a call, because TypeScript keeps `this.disposed` narrowed
   * from an earlier check across an `await` that may have disposed. */
  private isDisposed(): boolean {
    return this.disposed;
  }

  private blocker(): Exclude<AgentServerBlocker, "failed"> | undefined {
    if (this.deps.storageDirectory === undefined) return "no-folder";
    const trusted = this.deps.isTrusted ?? (() => vscode.workspace.isTrusted);
    if (!trusted()) return "untrusted";
    const enabled =
      this.deps.isEnabled ??
      (() =>
        vscode.workspace
          .getConfiguration("pythonOnViya")
          .get<boolean>(ENABLED_SETTING, false));
    // A failed start leaves `running` unset with nothing blocking, which
    // `status` reports as "failed"; the next `refresh` tries again.
    return enabled() ? undefined : "disabled";
  }

  private async reconcile(): Promise<void> {
    if (this.disposed) return;
    const wanted = this.blocker() === undefined;
    if (wanted && this.running === undefined) {
      await this.start();
    } else if (!wanted && this.running !== undefined) {
      await this.stop();
    } else if (!wanted) {
      // A crash leaves its file behind, and no start is coming to clear it.
      this.removeHeadersFile();
    }
  }

  private async start(): Promise<void> {
    const directory = this.deps.storageDirectory;
    if (directory === undefined) return;
    const { log } = this.deps;
    const stored = preferredPort(
      this.deps.workspaceState.get<unknown>(PORT_STATE_KEY),
    );
    const secret = createSecret();

    let server: AgentServer;
    try {
      server = await startAgentServer({
        port: stored,
        secret,
        info: { name: AGENT_SERVER_NAME, version: this.deps.version },
        // Debug, not warn: anything on this machine can send a request, and
        // one refused request follows every reload by design.
        onRejected: (rejection) => {
          log.debug(
            vscode.l10n.t(
              "The MCP server refused a request: {0} {1}",
              rejection.status,
              rejection.message,
            ),
          );
        },
        onError: (error) => {
          log.debug(
            vscode.l10n.t(
              "An MCP server request ended early: {0}",
              describe(error),
            ),
          );
        },
      });
    } catch (error) {
      log.error(
        vscode.l10n.t("The MCP server did not start: {0}", describe(error)),
      );
      return;
    }

    if (this.disposed) {
      await server.close();
      return;
    }

    let headersFile: string;
    try {
      headersFile = writeHeadersFile(directory, server.port, secret);
    } catch (error) {
      await server.close();
      log.error(
        vscode.l10n.t(
          "The MCP server did not start: its headers file could not be written: {0}",
          describe(error),
        ),
      );
      return;
    }

    this.running = { server, headersFile };
    log.info(
      vscode.l10n.t(
        "The MCP server for Claude Code is listening on {0}.",
        agentServerUrl(server.port),
      ),
    );

    if (server.port !== stored) {
      try {
        await this.deps.workspaceState.update(PORT_STATE_KEY, server.port);
      } catch (error) {
        // The server runs either way; the next start just cannot ask for
        // this port again.
        log.warn(
          vscode.l10n.t(
            "The MCP server's port could not be kept for the next start: {0}",
            describe(error),
          ),
        );
      }
      // Disposed while the port was being stored: the server is already
      // closed, so there is nothing left to register again.
      if (this.isDisposed()) return;
      if (stored !== 0) {
        log.warn(
          vscode.l10n.t(
            "The MCP server's port {0} was taken, so it now uses {1}. Register it with Claude Code again.",
            stored,
            server.port,
          ),
        );
        this.deps.onPortChanged?.(stored, server.port);
      }
    }
  }

  private async stop(): Promise<void> {
    const running = this.running;
    if (running === undefined) return;
    this.running = undefined;
    this.removeHeadersFile();
    await running.server.close();
    this.deps.log.info(
      vscode.l10n.t("The MCP server for Claude Code stopped."),
    );
  }

  private removeHeadersFile(): void {
    const directory = this.deps.storageDirectory;
    if (directory === undefined) return;
    try {
      removeHeadersFiles(directory);
    } catch (error) {
      // Logged, not rethrown: the server is stopping either way, and the
      // file's secret dies with it — the next start writes a new one.
      this.deps.log.warn(
        vscode.l10n.t(
          "The MCP server's headers file could not be removed: {0}",
          describe(error),
        ),
      );
    }
  }
}

/** What the setup command needs beyond the controller. Every member is
 * injectable because the integration host has no clipboard on CI and no
 * say over which shell VS Code thinks is the default. */
export interface SetUpClaudeCodeDeps {
  readonly writeClipboard?: ((text: string) => Thenable<void>) | undefined;
  /** Defaults to turning `pythonOnViya.agentServer.enabled` on in the user's
   * settings. */
  readonly enableSetting?: (() => Thenable<void>) | undefined;
  /** Defaults to `vscode.env.shell`. */
  readonly shellPath?: string | undefined;
  readonly platform?: HostPlatform | undefined;
  /** Defaults to the first workspace folder. */
  readonly folder?: vscode.Uri | undefined;
}

/** The command's outcome, for tests; the user sees the messages. */
export type SetUpClaudeCodeResult =
  | {
      readonly kind: "copied";
      readonly line: string;
      readonly shell: ShellKind;
    }
  | { readonly kind: "not-running"; readonly reason: AgentServerBlocker }
  | { readonly kind: "declined" }
  | { readonly kind: "setting-not-saved" }
  | { readonly kind: "unquotable-path" };

/**
 * **Python on Viya: Set Up Claude Code Access.** Turns the server on (after
 * asking) when it is off, then copies the line that registers it with
 * Claude Code, quoted for the default terminal's shell, and offers to paste
 * it into a new terminal in the workspace folder. The line carries the port
 * and the headers file's path, never the secret.
 */
export async function setUpClaudeCode(
  controller: AgentServerController,
  log: AgentServerLog,
  deps: SetUpClaudeCodeDeps = {},
): Promise<SetUpClaudeCodeResult> {
  await controller.refresh();
  let status = controller.status();

  if (status.kind === "off" && status.reason === "disabled") {
    const turnOn = vscode.l10n.t("Turn On");
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t("Turn on the MCP server for Claude Code?"),
      {
        modal: true,
        detail: vscode.l10n.t(
          "It listens on 127.0.0.1 only and answers only a client that holds this window's secret. Claude Code reads the secret from a file in this folder's private extension storage. Turning it on applies to every trusted folder you open; turn it off again in Settings.",
        ),
      },
      turnOn,
    );
    if (choice !== turnOn) return { kind: "declined" };
    try {
      await (
        deps.enableSetting ??
        (() =>
          vscode.workspace
            .getConfiguration("pythonOnViya")
            .update(ENABLED_SETTING, true, vscode.ConfigurationTarget.Global))
      )();
    } catch (error) {
      // Most often a user settings.json VS Code cannot parse. Said plainly
      // here rather than left to the command's generic failure.
      log.error(
        vscode.l10n.t(
          "The MCP server setting could not be saved: {0}",
          describe(error),
        ),
      );
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          "The MCP server for Claude Code was not turned on: pythonOnViya.agentServer.enabled could not be saved to your user settings. Check that your settings.json is valid, then run this command again. The Python on Viya log says why.",
        ),
      );
      return { kind: "setting-not-saved" };
    }
    await controller.refresh();
    status = controller.status();
  }

  if (status.kind === "off") {
    void vscode.window.showWarningMessage(blockerMessage(status.reason));
    return { kind: "not-running", reason: status.reason };
  }

  const platform =
    deps.platform ?? (process.platform === "win32" ? "win32" : "other");
  const helper = headersHelperCommand(status.headersFile, platform);
  if (helper === undefined) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Claude Code cannot be registered from this folder: the path to its extension storage contains a character the helper's shell would change. See the Python on Viya log for the path.",
      ),
    );
    log.error(
      vscode.l10n.t(
        "The MCP server's headers file path cannot be quoted safely: {0}",
        status.headersFile,
      ),
    );
    return { kind: "unquotable-path" };
  }

  // `env.shell` is empty until VS Code has resolved a default; on Windows
  // that default is PowerShell, and a POSIX line would fail there.
  const shellPath = deps.shellPath ?? vscode.env.shell;
  const shell =
    shellPath === "" && platform === "win32"
      ? "powershell"
      : shellKindFor(shellPath);
  const line = registrationCommand(status.port, helper, shell, platform);
  await (
    deps.writeClipboard ?? ((text) => vscode.env.clipboard.writeText(text))
  )(line);
  log.info(vscode.l10n.t("Claude Code registration command: {0}", line));

  const paste = vscode.l10n.t("Paste into a New Terminal");
  void vscode.window
    .showInformationMessage(
      vscode.l10n.t(
        "Copied the command that registers the MCP server with Claude Code, quoted for {0}. Run it in a terminal in this folder, then start Claude Code there.",
        shellLabel(shell),
      ),
      paste,
    )
    .then((choice) => {
      if (choice !== paste) return;
      const cwd = deps.folder ?? vscode.workspace.workspaceFolders?.[0]?.uri;
      const terminal = vscode.window.createTerminal({
        name: vscode.l10n.t("Claude Code setup"),
        ...(cwd === undefined ? {} : { cwd }),
      });
      terminal.show();
      // Not executed: the user reads it and presses Enter.
      terminal.sendText(line, false);
    });

  return { kind: "copied", line, shell };
}

/**
 * Wires the controller to the setting, to trust being granted, and to its
 * command. Activation stays cheap: with the setting off — the default — the
 * first `refresh` reads one setting and lists the folder's extension storage
 * for a file a crash left behind.
 */
export function registerAgentServer(
  context: vscode.ExtensionContext,
  log: AgentServerLog,
): AgentServerController {
  const controller = new AgentServerController({
    workspaceState: context.workspaceState,
    storageDirectory: context.storageUri?.fsPath,
    version: extensionVersion(context.extension),
    log,
    onPortChanged: () => {
      const again = vscode.l10n.t("Register Again");
      void vscode.window
        .showWarningMessage(
          vscode.l10n.t(
            "The MCP server for Claude Code moved to a new port because its old one was taken. Register it with Claude Code again.",
          ),
          again,
        )
        .then((choice) => {
          if (choice === again) {
            void vscode.commands.executeCommand(SET_UP_CLAUDE_CODE_COMMAND);
          }
        });
    },
  });

  context.subscriptions.push(
    controller,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`pythonOnViya.${ENABLED_SETTING}`)) {
        void controller.refresh();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void controller.refresh();
    }),
    vscode.commands.registerCommand(SET_UP_CLAUDE_CODE_COMMAND, () =>
      setUpClaudeCode(controller, log),
    ),
  );

  void controller.refresh();
  return controller;
}

function blockerMessage(reason: AgentServerBlocker): string {
  switch (reason) {
    case "no-folder":
      return vscode.l10n.t(
        "Open a folder first. The MCP server for Claude Code keeps its port and secret with the folder, and Claude Code registers it per folder.",
      );
    case "untrusted":
      return vscode.l10n.t(
        "The MCP server for Claude Code needs a trusted workspace. Trust this folder, then run this command again.",
      );
    case "disabled":
      return vscode.l10n.t(
        "A workspace or folder setting keeps pythonOnViya.agentServer.enabled off, so the MCP server for Claude Code did not start.",
      );
    case "failed":
      return vscode.l10n.t(
        "The MCP server for Claude Code did not start. The Python on Viya log says why.",
      );
  }
}

function shellLabel(shell: ShellKind): string {
  switch (shell) {
    case "posix":
      return vscode.l10n.t("bash or zsh");
    case "cmd":
      return vscode.l10n.t("Command Prompt");
    case "powershell":
      return vscode.l10n.t("PowerShell");
  }
}

function extensionVersion(extension: vscode.Extension<unknown>): string {
  const manifest: unknown = extension.packageJSON;
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : "0.0.0";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

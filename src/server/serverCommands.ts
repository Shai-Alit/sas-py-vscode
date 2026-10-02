// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The SAS Server view's context-menu commands that change files (13p-ii):
 * New Folder, New File, Rename, Delete, Upload Files and Download.
 *
 * A thin `vscode` shell, the same shape as `src/content/contentCommands.ts`.
 * Each call is a `ServerAdapter` method, unit-tested; upload and download are
 * 13a's `uploadFiles` and `downloadItem` (`src/content/contentTransfer.ts`)
 * over {@link serverTransferEndpoint}.
 *
 * Where it differs from SAS Content:
 *
 * - **Delete is permanent, behind a modal.** The compute server has no
 *   recycle bin, and a folder goes with everything in it (Finding 13.33).
 * - **A node from another profile is refused.** Its links name that
 *   profile's session, as `serverTree.ts` explains, so a command on one left
 *   over from before a profile switch says to refresh rather than send.
 * - **Download obeys the context's `allowDownload`** (upstream's attribute).
 *   The menu hides it; the command checks again, since a keybinding or the
 *   palette could still reach it.
 *
 * Every change refreshes the whole tree: a node's identity is its path
 * (`serverTree.ts`), so the expansion VS Code keeps survives the reload.
 */

import * as vscode from "vscode";

import {
  downloadItem,
  uploadFiles,
  type TransferEndpoint,
} from "../content/contentTransfer";
import { isSafeLocalName } from "../content/transfer";
import {
  MAX_SERVER_TRANSFER_BYTES,
  type ServerAdapter,
  type ServerResult,
} from "./adapter";
import { localiseServerProblem } from "./messages";
import { isValidServerName } from "./move";
import { describeServerProblem, type ServerProblem } from "./problems";
import { isServerTreeItem, type ServerTreeItem } from "./serverTree";
import { planServerDownload } from "./transfer";
import { type ServerItem } from "./types";

export const CREATE_SERVER_FOLDER_COMMAND = "pythonOnViya.createServerFolder";
export const CREATE_SERVER_FILE_COMMAND = "pythonOnViya.createServerFile";
export const RENAME_SERVER_ITEM_COMMAND = "pythonOnViya.renameServerItem";
export const DELETE_SERVER_ITEM_COMMAND = "pythonOnViya.deleteServerItem";
export const UPLOAD_TO_SERVER_FOLDER_COMMAND =
  "pythonOnViya.uploadToServerFolder";
export const DOWNLOAD_SERVER_ITEM_COMMAND = "pythonOnViya.downloadServerItem";

/** What the commands need from `serverExplorer.ts`. */
export interface ServerCommandDeps {
  /** The adapter for the active profile, or `undefined` with none. */
  currentAdapter(): ServerAdapter | undefined;
  /** Reloads the whole tree. */
  refresh(): void;
  /** Drops a profile's connection once a call finds its session gone. */
  forgetProfile(profileId: string): void;
  /** Whether the compute context allows downloads (`allowDownload`). */
  downloadAllowed(): boolean;
  log: vscode.LogOutputChannel;
  /** The tree view id, for the progress spinner's location. */
  viewId: string;
}

/** Registers the commands. Every disposable goes on `context.subscriptions`. */
export function registerServerCommands(
  context: vscode.ExtensionContext,
  deps: ServerCommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CREATE_SERVER_FOLDER_COMMAND,
      (node?: unknown) => createServerChild(deps, node, "folder"),
    ),
    vscode.commands.registerCommand(
      CREATE_SERVER_FILE_COMMAND,
      (node?: unknown) => createServerChild(deps, node, "file"),
    ),
    vscode.commands.registerCommand(
      RENAME_SERVER_ITEM_COMMAND,
      (node?: unknown) => renameServerItem(deps, node),
    ),
    vscode.commands.registerCommand(
      DELETE_SERVER_ITEM_COMMAND,
      (node?: unknown) => deleteServerItem(deps, node),
    ),
    vscode.commands.registerCommand(
      UPLOAD_TO_SERVER_FOLDER_COMMAND,
      (node?: unknown) => uploadToServerFolder(deps, node),
    ),
    vscode.commands.registerCommand(
      DOWNLOAD_SERVER_ITEM_COMMAND,
      (node?: unknown) => downloadServerItem(deps, node),
    ),
  );
}

/** The node and the adapter for its profile, or `undefined` after saying why
 * not. */
function resolve(
  deps: ServerCommandDeps,
  node: unknown,
): { node: ServerTreeItem; adapter: ServerAdapter } | undefined {
  if (!isServerTreeItem(node)) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("Select an item in the SAS Server view first."),
    );
    return undefined;
  }
  const adapter = deps.currentAdapter();
  if (adapter === undefined) {
    void vscode.window.showErrorMessage(
      localiseServerProblem({ code: "not-connected" }),
    );
    return undefined;
  }
  if (adapter.profileId !== node.profileId) {
    deps.refresh();
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "That item was listed under another connection profile. Refresh the SAS Server view and try again.",
      ),
    );
    return undefined;
  }
  return { node, adapter };
}

/** "New Folder" and "New File" on a folder. */
export async function createServerChild(
  deps: ServerCommandDeps,
  target: unknown,
  kind: "folder" | "file",
): Promise<void> {
  const resolved = resolve(deps, target);
  if (resolved === undefined) return;
  const { node, adapter } = resolved;
  const parent = node.item;
  const label = node.rootLabel ?? parent.name;

  const name = await vscode.window.showInputBox({
    title:
      kind === "folder"
        ? vscode.l10n.t('New folder in "{0}"', label)
        : vscode.l10n.t('New file in "{0}"', label),
    prompt:
      kind === "folder"
        ? vscode.l10n.t("Name for the new folder")
        : vscode.l10n.t("Name for the new file, including its extension"),
    ...(kind === "file"
      ? { value: "untitled.py", valueSelection: [0, "untitled".length] }
      : {}),
    ignoreFocusOut: true,
    validateInput: validateName,
  });
  if (name === undefined) return;
  const chosen = name.trim();

  await run(
    deps,
    adapter,
    (signal) =>
      kind === "folder"
        ? adapter.createFolder(parent, chosen, { signal })
        : adapter.createFile(parent, chosen, undefined, { signal }),
    kind === "folder"
      ? vscode.l10n.t('Creating folder "{0}"…', chosen)
      : vscode.l10n.t('Creating file "{0}"…', chosen),
  );
}

/** "Rename" on a file or folder below the root. */
export async function renameServerItem(
  deps: ServerCommandDeps,
  target: unknown,
): Promise<void> {
  const resolved = resolve(deps, target);
  if (resolved === undefined) return;
  const { node, adapter } = resolved;
  const { item } = node;
  // The menus already keep Rename off the root; this holds for any caller.
  if (node.rootLabel !== undefined) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("The SAS Server view's top folder can't be renamed."),
    );
    return;
  }

  const name = await vscode.window.showInputBox({
    title: vscode.l10n.t('Rename "{0}"', item.name),
    value: item.name,
    valueSelection: renameSelection(item.name),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const local = validateName(value);
      if (local !== undefined) return local;
      return value.trim() === item.name
        ? vscode.l10n.t("That is already its name.")
        : undefined;
    },
  });
  if (name === undefined) return;
  const chosen = name.trim();
  if (chosen === item.name) return;

  await run(
    deps,
    adapter,
    (signal) => adapter.rename(item, chosen, { signal }),
    vscode.l10n.t('Renaming to "{0}"…', chosen),
  );
}

/** "Delete" on a file or folder below the root: permanent, behind a modal. */
export async function deleteServerItem(
  deps: ServerCommandDeps,
  target: unknown,
): Promise<void> {
  const resolved = resolve(deps, target);
  if (resolved === undefined) return;
  const { node, adapter } = resolved;
  const { item } = node;
  // The menus already keep Delete off the root; this holds for any caller.
  if (node.rootLabel !== undefined) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("The SAS Server view's top folder can't be deleted."),
    );
    return;
  }

  const deleteLabel = vscode.l10n.t("Delete Permanently");
  const confirm = await vscode.window.showWarningMessage(
    item.isDirectory
      ? vscode.l10n.t(
          'Permanently delete the folder "{0}" and everything inside it?',
          item.name,
        )
      : vscode.l10n.t('Permanently delete "{0}"?', item.name),
    {
      modal: true,
      detail: vscode.l10n.t(
        "This cannot be undone. The SAS server has no recycle bin.",
      ),
    },
    deleteLabel,
  );
  if (confirm !== deleteLabel) return;

  await run(
    deps,
    adapter,
    (signal) => adapter.delete(item, { signal }),
    vscode.l10n.t('Deleting "{0}"…', item.name),
  );
}

/** "Upload Files…" on a folder. */
export async function uploadToServerFolder(
  deps: ServerCommandDeps,
  target: unknown,
): Promise<void> {
  const resolved = resolve(deps, target);
  if (resolved === undefined) return;
  await uploadFiles(
    serverTransferEndpoint(deps, resolved.adapter),
    resolved.node.item,
  );
}

/** "Download…" on a file or folder. */
export async function downloadServerItem(
  deps: ServerCommandDeps,
  target: unknown,
): Promise<void> {
  if (!deps.downloadAllowed()) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Downloads from the SAS server are turned off for this compute context. Contact your SAS administrator.",
      ),
    );
    return;
  }
  const resolved = resolve(deps, target);
  if (resolved === undefined) return;
  await downloadItem(
    serverTransferEndpoint(deps, resolved.adapter),
    resolved.node.item,
  );
}

/** The SAS Server view's {@link TransferEndpoint}. */
export function serverTransferEndpoint(
  deps: Pick<ServerCommandDeps, "log" | "refresh">,
  adapter: ServerAdapter,
): TransferEndpoint<ServerItem, ServerItem, ServerProblem> {
  return {
    logLabel: "SAS Server",
    maxUploadBytes: MAX_SERVER_TRANSFER_BYTES,
    uploadTooLarge: vscode.l10n.t(
      "It is larger than the {0} MB this extension uploads.",
      String(MAX_SERVER_TRANSFER_BYTES / (1024 * 1024)),
    ),
    log: deps.log,
    nameOf: (item) => item.name,
    createFile: (folder, name, bytes, signal) =>
      adapter.createFile(folder, name, bytes, { signal }),
    planDownload: (item, signal) => planServerDownload(adapter, item, signal),
    readFile: (item, signal) => adapter.downloadFile(item, { signal }),
    downloadObjection: (item) =>
      isSafeLocalName(item.name)
        ? undefined
        : vscode.l10n.t(
            '"{0}" can\'t be saved under that name on this computer. Rename it on the SAS server first.',
            item.name,
          ),
    problemMessage: serverTransferProblemMessage,
    describeProblem: describeServerProblem,
    refresh: () => {
      deps.refresh();
    },
  };
}

/** {@link localiseServerProblem}, except that `too-large` is about a
 * transfer, not about opening a file in the editor. */
export function serverTransferProblemMessage(problem: ServerProblem): string {
  if (problem.code === "too-large") {
    return vscode.l10n.t(
      "It is larger than the {0} MB this extension downloads.",
      String(Math.floor(problem.limitBytes / (1024 * 1024))),
    );
  }
  return localiseServerProblem(problem);
}

/**
 * Run one adapter change behind the view's progress spinner, cancellable,
 * then reload the tree whatever the outcome. A failure the user's Cancel
 * caused stays silent; every other one is logged and shown, and a gone
 * session is forgotten so the view's Connect comes back. The same contract
 * as `contentCommands.ts`'s `run`.
 */
async function run<T>(
  deps: ServerCommandDeps,
  adapter: ServerAdapter,
  action: (signal: AbortSignal) => Promise<ServerResult<T>>,
  title: string,
): Promise<void> {
  const { result, aborted } = await vscode.window.withProgress(
    { location: { viewId: deps.viewId }, title, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => {
        controller.abort();
      });
      try {
        const value = await action(controller.signal);
        return { result: value, aborted: controller.signal.aborted };
      } finally {
        sub.dispose();
      }
    },
  );

  if (!result.ok) {
    if (
      result.problem.code === "compute" &&
      result.problem.problem.code === "session-gone"
    ) {
      deps.forgetProfile(adapter.profileId);
    }
    if (!aborted) reportServerProblem(deps.log, result.problem);
  }
  deps.refresh();
}

/** Logs a problem's technical sentence and shows the user's. */
export function reportServerProblem(
  log: vscode.LogOutputChannel,
  problem: ServerProblem,
): void {
  log.error(vscode.l10n.t("SAS Server: {0}", describeServerProblem(problem)));
  void vscode.window.showErrorMessage(localiseServerProblem(problem));
}

/** Per-keystroke name checks; the server's are the authority. */
function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return vscode.l10n.t("Enter a name.");
  if (!isValidServerName(trimmed)) {
    return trimmed.includes("/")
      ? vscode.l10n.t('A name cannot contain "/".')
      : vscode.l10n.t("Choose a different name.");
  }
  return undefined;
}

/** Select the base name (before the last `.`) in the rename box, so retyping
 * keeps the extension. */
function renameSelection(name: string): [number, number] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [0, dot] : [0, name.length];
}

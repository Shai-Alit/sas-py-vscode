// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Upload local files into a SAS Content folder, and download a SAS Content
 * file or folder to local disk (13a) — the two directions Phase 6's
 * `pythonOnViyaContent:` `FileSystemProvider` and tree did not cover. The SAS
 * Server view uploads and downloads through the same two functions (13p-ii).
 *
 * Structure follows: `uploadResource` / `uploadUrisToTarget` /
 * `downloadContentItems` in sassoftware/vscode-sas-extension (Apache-2.0) —
 * read for what they do, not transcribed. Upstream also uploads folders, from
 * a platform-dependent picker; this slice uploads files only, several at a
 * time, and downloads a file or a whole folder.
 *
 * A thin `vscode` shell. {@link uploadFiles} and {@link downloadItem} talk to
 * a view only through a {@link TransferEndpoint}: create a file with its
 * bytes, plan a download, read a file's bytes, and word a problem. SAS
 * Content's endpoint is {@link contentTransferEndpoint}, over
 * `ContentAdapter.createFile` and `downloadFileContent` and
 * `src/content/transfer.ts`'s `planDownload`; the SAS Server view's is in
 * `src/server/serverCommands.ts`. What a folder download writes is decided by
 * the shared planner, unit-tested. This file picks the files or the
 * destination, reads and writes the local disk through `vscode.workspace.fs`,
 * shows progress, and reports.
 *
 * Every file is attempted even when an earlier one fails, so one name clash
 * does not strand the rest; the summary says how many made it, and the log
 * has each failure's technical sentence. Cancel stops before the next file,
 * and the summary then says it was cancelled and, for more than one file,
 * how many made it, rather than reading as if the job had finished.
 */

import * as vscode from "vscode";

import { MAX_TRANSFER_BYTES, type ContentAdapter } from "./adapter";
import { type ContentCommandDeps } from "./contentCommands";
import { localiseContentProblem, reportNoTarget } from "./messages";
import { describeContentProblem, type ContentProblem } from "./problems";
import {
  isDownloadable,
  isSafeLocalName,
  planDownload,
  type DownloadPlan,
  type SkipReason,
} from "./transfer";
import { type ContentItem } from "./types";

/** Registers the two commands. Every disposable goes on `context.subscriptions`. */
export function registerContentTransferCommands(
  context: vscode.ExtensionContext,
  deps: ContentCommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "pythonOnViya.uploadToContentFolder",
      (item?: ContentItem) => upload(deps, item),
    ),
    vscode.commands.registerCommand(
      "pythonOnViya.downloadContentItem",
      (item?: ContentItem) => download(deps, item),
    ),
  );
}

/** A view call's outcome, as both adapters' results satisfy it. */
export type TransferOutcome<T, P> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: P };

/**
 * What {@link uploadFiles} and {@link downloadItem} need from a view. `I` is
 * an item in its tree, `S` what a file's bytes are read from, `P` a problem.
 */
export interface TransferEndpoint<I, S, P> {
  /** Starts each log line, as `SAS Content` or `SAS Server`. */
  readonly logLabel: string;
  /** The largest file an upload sends. */
  readonly maxUploadBytes: number;
  /** Why a file over {@link maxUploadBytes} was not uploaded. */
  readonly uploadTooLarge: string;
  readonly log: vscode.LogOutputChannel;
  nameOf(item: I): string;
  /** Creates `name` in `folder` holding `bytes`. A name already taken is
   * refused, not overwritten. */
  createFile(
    folder: I,
    name: string,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<TransferOutcome<unknown, P>>;
  planDownload(
    item: I,
    signal: AbortSignal,
  ): Promise<TransferOutcome<DownloadPlan<S>, P>>;
  readFile(
    source: S,
    signal: AbortSignal,
  ): Promise<TransferOutcome<Uint8Array, P>>;
  /** Why `item` cannot be downloaded at all, as a sentence for the user, or
   * `undefined` when it can. Checked before the folder picker opens. */
  downloadObjection(item: I): string | undefined;
  /** The problem as a sentence for the user. */
  problemMessage(problem: P): string;
  /** The problem as a log fragment. */
  describeProblem(problem: P): string;
  /** Reloads `folder` in the tree after an upload. */
  refresh(folder: I): void;
}

/** SAS Content's {@link TransferEndpoint}. */
export function contentTransferEndpoint(
  deps: ContentCommandDeps,
  adapter: ContentAdapter,
): TransferEndpoint<ContentItem, string, ContentProblem> {
  return {
    logLabel: "SAS Content",
    maxUploadBytes: MAX_TRANSFER_BYTES,
    uploadTooLarge: vscode.l10n.t(
      "It is larger than the {0} MB SAS Viya accepts for one file.",
      String(MAX_TRANSFER_BYTES / (1024 * 1024)),
    ),
    log: deps.log,
    nameOf: (item) => item.name,
    createFile: (folder, name, bytes, signal) =>
      adapter.createFile(folder, name, signal, bytes),
    planDownload: (item, signal) => planDownload(adapter, item, signal),
    readFile: async (href, signal) => {
      const result = await adapter.downloadFileContent(href, signal);
      return result.ok ? { ok: true, value: result.value.bytes } : result;
    },
    downloadObjection: (item) => {
      if (!isDownloadable(item)) {
        return vscode.l10n.t(
          '"{0}" can\'t be downloaded. Only files and folders can be.',
          item.name,
        );
      }
      if (!isSafeLocalName(item.name)) {
        return vscode.l10n.t(
          '"{0}" can\'t be saved under that name on this computer. Rename it in SAS Content first.',
          item.name,
        );
      }
      return undefined;
    },
    problemMessage: transferProblemMessage,
    describeProblem: describeContentProblem,
    refresh: (folder) => {
      deps.refresh(folder);
    },
  };
}

/** "Upload Files…" on a SAS Content folder. */
export async function upload(
  deps: ContentCommandDeps,
  folder: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || folder === undefined) {
    reportNoTarget(adapter);
    return;
  }
  await uploadFiles(contentTransferEndpoint(deps, adapter), folder);
}

/** "Download…" on a SAS Content file or folder. */
export async function download(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }
  await downloadItem(contentTransferEndpoint(deps, adapter), item);
}

/** One file that did not transfer, and the localised reason. */
interface Failure {
  readonly name: string;
  readonly message: string;
}

/**
 * Picks one or more local files and creates each in `folder` with its bytes.
 * A name already taken in the folder is refused by the endpoint, not
 * overwritten.
 */
export async function uploadFiles<I, S, P>(
  endpoint: TransferEndpoint<I, S, P>,
  folder: I,
): Promise<void> {
  const folderName = endpoint.nameOf(folder);
  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Upload files to "{0}"', folderName),
    openLabel: vscode.l10n.t("Upload"),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
  });
  if (picked === undefined || picked.length === 0) return;

  const failures: Failure[] = [];
  let uploaded = 0;
  // Set inside the progress callback, which the compiler does not follow.
  let cancelled = false as boolean;
  const fail = (name: string, message: string, technical: string): void => {
    failures.push({ name, message });
    endpoint.log.error(
      vscode.l10n.t(
        '{0}: upload of "{1}" failed: {2}',
        endpoint.logLabel,
        name,
        technical,
      ),
    );
  };

  await withTransferProgress(
    vscode.l10n.t('Uploading to "{0}"', folderName),
    async (progress, signal) => {
      for (const [index, uri] of picked.entries()) {
        if (aborted(signal)) {
          cancelled = true;
          return;
        }
        // `Uri.path` is already decoded (only `toString()` percent-encodes),
        // so this is the name as it is spelled on disk.
        const name = uri.path.slice(uri.path.lastIndexOf("/") + 1);
        progress.report({
          message: vscode.l10n.t(
            "{0} ({1} of {2})",
            name,
            String(index + 1),
            String(picked.length),
          ),
          increment: 100 / picked.length,
        });

        let bytes: Uint8Array;
        try {
          // `stat` first, so a file far over the limit is never read into
          // memory at all; the length is checked again after the read in case
          // the file grew in between.
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > endpoint.maxUploadBytes) {
            fail(name, endpoint.uploadTooLarge, `${String(stat.size)} bytes`);
            continue;
          }
          bytes = await vscode.workspace.fs.readFile(uri);
        } catch (error) {
          fail(
            name,
            vscode.l10n.t("It could not be read from this computer."),
            String(error),
          );
          continue;
        }
        if (bytes.byteLength > endpoint.maxUploadBytes) {
          fail(
            name,
            endpoint.uploadTooLarge,
            `${String(bytes.byteLength)} bytes`,
          );
          continue;
        }

        const result = await endpoint.createFile(folder, name, bytes, signal);
        if (result.ok) {
          uploaded += 1;
        } else if (aborted(signal)) {
          cancelled = true;
          return;
        } else {
          fail(
            name,
            endpoint.problemMessage(result.problem),
            endpoint.describeProblem(result.problem),
          );
        }
      }
    },
  );

  endpoint.refresh(folder);

  if (cancelled) {
    let message: string;
    // `cancelled` is set only before a file starts or when its own upload was
    // aborted, so with one file picked nothing was uploaded, and there is no
    // count worth giving.
    if (picked.length === 1) {
      message = vscode.l10n.t('Upload to "{0}" cancelled.', folderName);
    } else if (failures.length === 0) {
      message = vscode.l10n.t(
        'Upload to "{0}" cancelled. {1} of {2} files were uploaded.',
        folderName,
        String(uploaded),
        String(picked.length),
      );
    } else {
      message = vscode.l10n.t(
        'Upload to "{0}" cancelled. {1} of {2} files were uploaded, and {3} could not be. See the Python on Viya log for details.',
        folderName,
        String(uploaded),
        String(picked.length),
        String(failures.length),
      );
    }
    void vscode.window.showInformationMessage(message);
    return;
  }

  const first = failures[0];
  if (first === undefined) {
    // No failure and no cancel: every picked file was uploaded.
    void vscode.window.showInformationMessage(
      uploaded === 1
        ? vscode.l10n.t('Uploaded 1 file to "{0}".', folderName)
        : vscode.l10n.t(
            'Uploaded {0} files to "{1}".',
            String(uploaded),
            folderName,
          ),
    );
    return;
  }
  let message: string;
  if (picked.length === 1) {
    message = vscode.l10n.t(
      'Could not upload "{0}". {1}',
      first.name,
      first.message,
    );
  } else if (failures.length === 1) {
    message = vscode.l10n.t(
      'Uploaded {0} of {1} files to "{2}". Could not upload "{3}". {4}',
      String(uploaded),
      String(picked.length),
      folderName,
      first.name,
      first.message,
    );
  } else {
    message = vscode.l10n.t(
      'Uploaded {0} of {1} files to "{2}". The rest could not be uploaded. See the Python on Viya log for details.',
      String(uploaded),
      String(picked.length),
      folderName,
    );
  }
  void vscode.window.showErrorMessage(message);
}

/**
 * Picks a local folder and writes `item` into it under its own name — a
 * folder with everything below it. Asks first when something of that name is
 * already there; replacing a folder overwrites the files the download brings
 * and leaves everything else in it alone.
 */
export async function downloadItem<I, S, P>(
  endpoint: TransferEndpoint<I, S, P>,
  item: I,
): Promise<void> {
  const itemName = endpoint.nameOf(item);
  const objection = endpoint.downloadObjection(item);
  if (objection !== undefined) {
    void vscode.window.showErrorMessage(objection);
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Download "{0}"', itemName),
    openLabel: vscode.l10n.t("Download Here"),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  const destination = picked?.[0];
  if (destination === undefined) return;

  const target = vscode.Uri.joinPath(destination, itemName);
  let present: boolean;
  try {
    present = await exists(target);
  } catch (error) {
    endpoint.log.error(
      vscode.l10n.t(
        '{0}: download of "{1}" failed: {2}',
        endpoint.logLabel,
        itemName,
        String(error),
      ),
    );
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        'Could not download "{0}". The folder you chose could not be checked.',
        itemName,
      ),
    );
    return;
  }
  if (present) {
    const replace = vscode.l10n.t("Replace");
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        '"{0}" already exists in the folder you chose. Replace it?',
        itemName,
      ),
      {
        modal: true,
        detail: vscode.l10n.t(
          "Files with the same names are overwritten. Nothing else there is deleted.",
        ),
      },
      replace,
    );
    if (answer !== replace) return;
  }

  const failures: Failure[] = [];
  let written = 0;
  let total = 0;
  let skipped = 0;
  // Set inside the progress callback, which the compiler does not follow.
  let cancelled = false as boolean;
  const fail = (name: string, message: string, technical: string): void => {
    failures.push({ name, message });
    endpoint.log.error(
      vscode.l10n.t(
        '{0}: download of "{1}" failed: {2}',
        endpoint.logLabel,
        name,
        technical,
      ),
    );
  };

  await withTransferProgress(
    vscode.l10n.t('Downloading "{0}"', itemName),
    async (progress, signal) => {
      const plan = await endpoint.planDownload(item, signal);
      if (!plan.ok) {
        if (aborted(signal)) {
          cancelled = true;
        } else {
          fail(
            itemName,
            endpoint.problemMessage(plan.problem),
            endpoint.describeProblem(plan.problem),
          );
        }
        return;
      }

      try {
        for (const folder of plan.value.folders) {
          if (aborted(signal)) {
            cancelled = true;
            return;
          }
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(destination, ...folder),
          );
        }
      } catch (error) {
        fail(
          itemName,
          vscode.l10n.t("A folder could not be created on this computer."),
          String(error),
        );
        return;
      }

      // Counted only once the folders exist, so a download that stops before
      // then reports no file count and nothing left out.
      for (const skip of plan.value.skipped) {
        endpoint.log.warn(
          vscode.l10n.t(
            '{0}: "{1}" was not downloaded: {2}',
            endpoint.logLabel,
            skip.path.join("/"),
            describeSkip(skip.reason),
          ),
        );
      }
      skipped = plan.value.skipped.length;
      total = plan.value.files.length;

      for (const [index, file] of plan.value.files.entries()) {
        if (aborted(signal)) {
          cancelled = true;
          return;
        }
        const name = file.path.join("/");
        progress.report({
          message: vscode.l10n.t(
            "{0} ({1} of {2})",
            name,
            String(index + 1),
            String(total),
          ),
          increment: 100 / total,
        });

        const result = await endpoint.readFile(file.source, signal);
        if (!result.ok) {
          if (aborted(signal)) {
            cancelled = true;
            return;
          }
          fail(
            name,
            endpoint.problemMessage(result.problem),
            endpoint.describeProblem(result.problem),
          );
          continue;
        }
        try {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(destination, ...file.path),
            result.value,
          );
          written += 1;
        } catch (error) {
          fail(
            name,
            vscode.l10n.t("It could not be written to this computer."),
            String(error),
          );
        }
      }
    },
  );

  if (cancelled) {
    let message: string;
    // `cancelled` is set only before a file starts or when its own fetch was
    // aborted, so with one file or none nothing was downloaded, and there is
    // no count worth giving.
    if (total <= 1) {
      message = vscode.l10n.t('Download of "{0}" cancelled.', itemName);
    } else if (failures.length === 0) {
      message = vscode.l10n.t(
        'Download of "{0}" cancelled. {1} of {2} files were downloaded.',
        itemName,
        String(written),
        String(total),
      );
    } else {
      message = vscode.l10n.t(
        'Download of "{0}" cancelled. {1} of {2} files were downloaded, and {3} could not be. See the Python on Viya log for details.',
        itemName,
        String(written),
        String(total),
        String(failures.length),
      );
    }
    void vscode.window.showInformationMessage(withLeftOut(message, skipped));
    return;
  }

  const first = failures[0];
  if (first !== undefined) {
    let message: string;
    if (total <= 1) {
      message = vscode.l10n.t(
        'Could not download "{0}". {1}',
        first.name,
        first.message,
      );
    } else if (failures.length === 1) {
      message = vscode.l10n.t(
        'Downloaded {0} of {1} files from "{2}". Could not download "{3}". {4}',
        String(written),
        String(total),
        itemName,
        first.name,
        first.message,
      );
    } else {
      message = vscode.l10n.t(
        'Downloaded {0} of {1} files from "{2}". The rest could not be downloaded. See the Python on Viya log for details.',
        String(written),
        String(total),
        itemName,
      );
    }
    void vscode.window.showErrorMessage(withLeftOut(message, skipped));
    return;
  }
  // Nothing written and nothing skipped is a folder tree with no files in it:
  // its folders were still created, so it gets a summary like any other.
  const summary =
    written === 0 && skipped === 0
      ? vscode.l10n.t(
          'Downloaded "{0}". It has no files, so only its folders were created.',
          itemName,
        )
      : written === 1
        ? vscode.l10n.t('Downloaded 1 file from "{0}".', itemName)
        : vscode.l10n.t(
            'Downloaded {0} files from "{1}".',
            String(written),
            itemName,
          );
  const reveal = vscode.l10n.t("Show in Folder");
  const choice = await vscode.window.showInformationMessage(
    withLeftOut(summary, skipped),
    reveal,
  );
  if (choice === reveal) {
    await vscode.commands.executeCommand("revealFileInOS", target);
  }
}

/**
 * Run `work` behind a cancellable notification, and return what it returns.
 * Cancel aborts the signal the adapter calls are given; the loops check it
 * between files, so a file already on the wire is abandoned and nothing
 * after it starts. Also used by a copy's paste (`contentCopy.ts`, 13b).
 */
export async function withTransferProgress<T>(
  title: string,
  work: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    signal: AbortSignal,
  ) => Promise<T>,
): Promise<T> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => {
        controller.abort();
      });
      // A token cancelled already may deliver its event only later.
      if (token.isCancellationRequested) controller.abort();
      try {
        return await work(progress, controller.signal);
      } finally {
        sub.dispose();
      }
    },
  );
}

/** `signal.aborted`, read through a call so the compiler does not carry a
 * narrowing from one check across the `await` that can change it. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Whether anything already exists at `uri` on local disk. `stat` rejects
 * `FileNotFound` for a missing path — the answer, not an error. Anything else
 * (a permission problem) is rethrown for the caller to report.
 */
async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (
      error instanceof vscode.FileSystemError &&
      error.code === "FileNotFound"
    ) {
      return false;
    }
    throw error;
  }
}

/**
 * {@link localiseContentProblem}, with two changes for a transfer:
 *
 * - Its `content-too-large` sentence is about opening a file in the editor,
 *   which a download is not.
 * - A refusal whose envelope put its sentence in `message` and nothing human
 *   in `details` quotes that sentence. The Files service's blocked-type
 *   refusal is shaped that way (Finding 13.8: `details` holds only `path:`),
 *   and "refused (HTTP 400)" alone would not tell the user why their file
 *   was turned away.
 */
export function transferProblemMessage(problem: ContentProblem): string {
  if (problem.code === "content-too-large") {
    return vscode.l10n.t(
      "It is larger than the {0} MB this extension downloads.",
      String(Math.floor(problem.limitBytes / (1024 * 1024))),
    );
  }
  if (
    problem.code === "content-rejected" &&
    problem.error.status === 400 &&
    problem.error.detail === undefined &&
    problem.error.message !== undefined
  ) {
    return vscode.l10n.t("SAS Viya refused it: {0}", problem.error.message);
  }
  return localiseContentProblem(problem);
}

/** `message`, then how many items a download or a copy left out, when any
 * were. */
export function withLeftOut(message: string, skipped: number): string {
  if (skipped === 0) return message;
  return skipped === 1
    ? vscode.l10n.t(
        "{0} 1 item was left out. See the Python on Viya log for which, and why.",
        message,
      )
    : vscode.l10n.t(
        "{0} {1} items were left out. See the Python on Viya log for which, and why.",
        message,
        String(skipped),
      );
}

function describeSkip(reason: SkipReason): string {
  switch (reason) {
    case "not-a-file":
      return vscode.l10n.t("it is not a file");
    case "unsafe-name":
      return vscode.l10n.t(
        "its name can't be used for a file on this computer",
      );
    case "duplicate-name":
      return vscode.l10n.t(
        "another item in the same folder already has that name",
      );
    case "already-listed":
      return vscode.l10n.t(
        "it is the same folder as one already downloaded elsewhere in the tree",
      );
    case "too-deep":
      return vscode.l10n.t(
        "it is nested too deeply to download; a link may loop back to a folder above it",
      );
    case "listing-truncated":
      return vscode.l10n.t(
        "only part of it was; the folder has more entries than can be listed, and the rest were left out",
      );
  }
}

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Upload local files into a SAS Content folder, and download a SAS Content
 * file or folder to local disk (13a) — the two directions Phase 6's
 * `pythonOnViyaContent:` `FileSystemProvider` and tree did not cover.
 *
 * Structure follows: `uploadResource` / `uploadUrisToTarget` /
 * `downloadContentItems` in sassoftware/vscode-sas-extension (Apache-2.0) —
 * read for what they do, not transcribed. Upstream also uploads folders, from
 * a platform-dependent picker; this slice uploads files only, several at a
 * time, and downloads a file or a whole folder.
 *
 * A thin `vscode` shell, the same shape as `src/content/contentCommands.ts`:
 * the wire calls are `ContentAdapter.createFile` (with the file's bytes) and
 * `ContentAdapter.downloadFileContent`, and what a folder download writes is
 * decided by `src/content/transfer.ts`'s `planDownload`, all unit-tested.
 * This file picks the files or the destination, reads and writes the local
 * disk through `vscode.workspace.fs`, shows progress, and reports.
 *
 * Every file is attempted even when an earlier one fails, so one name clash
 * does not strand the rest; the summary says how many made it, and the log
 * has each failure's technical sentence. Cancel stops before the next file,
 * and the summary then says it was cancelled and how many made it, rather
 * than reading as if the job had finished.
 */

import * as vscode from "vscode";

import { MAX_TRANSFER_BYTES } from "./adapter";
import { type ContentCommandDeps, reportNoTarget } from "./contentCommands";
import { localiseContentProblem } from "./messages";
import { describeContentProblem, type ContentProblem } from "./problems";
import { isSafeLocalName, planDownload, type SkipReason } from "./transfer";
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

/** One file that did not transfer, and the localised reason. */
interface Failure {
  readonly name: string;
  readonly message: string;
}

/**
 * "Upload Files…" on a folder. Picks one or more local files and creates each
 * in `folder` with its bytes. A name already taken in the folder is refused by
 * the adapter's own name check, before anything is sent.
 */
export async function upload(
  deps: ContentCommandDeps,
  folder: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || folder === undefined) {
    reportNoTarget(adapter);
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Upload files to "{0}"', folder.name),
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
    deps.log.error(
      vscode.l10n.t(
        'SAS Content: upload of "{0}" failed: {1}',
        name,
        technical,
      ),
    );
  };

  await withTransferProgress(
    vscode.l10n.t('Uploading to "{0}"', folder.name),
    async (progress, signal) => {
      for (const [index, uri] of picked.entries()) {
        if (aborted(signal)) {
          cancelled = true;
          return;
        }
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
          if (stat.size > MAX_TRANSFER_BYTES) {
            fail(name, tooLargeToUpload(), `${String(stat.size)} bytes`);
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
        if (bytes.byteLength > MAX_TRANSFER_BYTES) {
          fail(name, tooLargeToUpload(), `${String(bytes.byteLength)} bytes`);
          continue;
        }

        const result = await adapter.createFile(folder, name, signal, bytes);
        if (result.ok) {
          uploaded += 1;
        } else if (aborted(signal)) {
          cancelled = true;
          return;
        } else {
          fail(
            name,
            transferProblemMessage(result.problem),
            describeContentProblem(result.problem),
          );
        }
      }
    },
  );

  deps.refresh(folder);

  if (cancelled) {
    void vscode.window.showInformationMessage(
      failures.length === 0
        ? vscode.l10n.t(
            'Upload to "{0}" cancelled. {1} of {2} files were uploaded.',
            folder.name,
            String(uploaded),
            String(picked.length),
          )
        : vscode.l10n.t(
            'Upload to "{0}" cancelled. {1} of {2} files were uploaded, and {3} could not be. See the Python on Viya log for details.',
            folder.name,
            String(uploaded),
            String(picked.length),
            String(failures.length),
          ),
    );
    return;
  }

  const first = failures[0];
  if (first === undefined) {
    if (uploaded === 0) return;
    void vscode.window.showInformationMessage(
      uploaded === 1
        ? vscode.l10n.t('Uploaded 1 file to "{0}".', folder.name)
        : vscode.l10n.t(
            'Uploaded {0} files to "{1}".',
            String(uploaded),
            folder.name,
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
      folder.name,
      first.name,
      first.message,
    );
  } else {
    message = vscode.l10n.t(
      'Uploaded {0} of {1} files to "{2}". The rest could not be uploaded. See the Python on Viya log for details.',
      String(uploaded),
      String(picked.length),
      folder.name,
    );
  }
  void vscode.window.showErrorMessage(message);
}

/**
 * "Download…" on a file or folder. Picks a local folder and writes the item
 * into it under its own name — a folder with everything below it. Asks first
 * when something of that name is already there; replacing a folder overwrites
 * the files the download brings and leaves everything else in it alone.
 */
export async function download(
  deps: ContentCommandDeps,
  item: ContentItem | undefined,
): Promise<void> {
  const adapter = deps.adapter();
  if (adapter === undefined || item === undefined) {
    reportNoTarget(adapter);
    return;
  }
  if (!isSafeLocalName(item.name)) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        '"{0}" can\'t be saved under that name on this computer. Rename it in SAS Content first.',
        item.name,
      ),
    );
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Download "{0}"', item.name),
    openLabel: vscode.l10n.t("Download Here"),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });
  const destination = picked?.[0];
  if (destination === undefined) return;

  const target = vscode.Uri.joinPath(destination, item.name);
  let present: boolean;
  try {
    present = await exists(target);
  } catch (error) {
    deps.log.error(
      vscode.l10n.t(
        'SAS Content: download of "{0}" failed: {1}',
        item.name,
        String(error),
      ),
    );
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        'Could not download "{0}". The folder you chose could not be checked.',
        item.name,
      ),
    );
    return;
  }
  if (present) {
    const replace = vscode.l10n.t("Replace");
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        '"{0}" already exists in the folder you chose. Replace it?',
        item.name,
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
    deps.log.error(
      vscode.l10n.t(
        'SAS Content: download of "{0}" failed: {1}',
        name,
        technical,
      ),
    );
  };

  await withTransferProgress(
    vscode.l10n.t('Downloading "{0}"', item.name),
    async (progress, signal) => {
      const plan = await planDownload(adapter, item, signal);
      if (!plan.ok) {
        if (aborted(signal)) {
          cancelled = true;
        } else {
          fail(
            item.name,
            transferProblemMessage(plan.problem),
            describeContentProblem(plan.problem),
          );
        }
        return;
      }

      for (const skip of plan.value.skipped) {
        deps.log.warn(
          vscode.l10n.t(
            'SAS Content: "{0}" was not downloaded: {1}',
            skip.path.join("/"),
            describeSkip(skip.reason),
          ),
        );
      }
      skipped = plan.value.skipped.length;
      total = plan.value.files.length;

      try {
        for (const folder of plan.value.folders) {
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(destination, ...folder),
          );
        }
      } catch (error) {
        fail(
          item.name,
          vscode.l10n.t("A folder could not be created on this computer."),
          String(error),
        );
        return;
      }

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

        const result = await adapter.downloadFileContent(file.href, signal);
        if (!result.ok) {
          if (aborted(signal)) {
            cancelled = true;
            return;
          }
          fail(
            name,
            transferProblemMessage(result.problem),
            describeContentProblem(result.problem),
          );
          continue;
        }
        try {
          await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(destination, ...file.path),
            result.value.bytes,
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
    if (total === 0) {
      message = vscode.l10n.t('Download of "{0}" cancelled.', item.name);
    } else if (failures.length === 0) {
      message = vscode.l10n.t(
        'Download of "{0}" cancelled. {1} of {2} files were downloaded.',
        item.name,
        String(written),
        String(total),
      );
    } else {
      message = vscode.l10n.t(
        'Download of "{0}" cancelled. {1} of {2} files were downloaded, and {3} could not be. See the Python on Viya log for details.',
        item.name,
        String(written),
        String(total),
        String(failures.length),
      );
    }
    void vscode.window.showInformationMessage(message);
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
        item.name,
        first.name,
        first.message,
      );
    } else {
      message = vscode.l10n.t(
        'Downloaded {0} of {1} files from "{2}". The rest could not be downloaded. See the Python on Viya log for details.',
        String(written),
        String(total),
        item.name,
      );
    }
    void vscode.window.showErrorMessage(message);
    return;
  }
  if (written === 0 && skipped === 0) return;

  const summary =
    written === 1
      ? vscode.l10n.t('Downloaded 1 file from "{0}".', item.name)
      : vscode.l10n.t(
          'Downloaded {0} files from "{1}".',
          String(written),
          item.name,
        );
  const message =
    skipped === 0
      ? summary
      : skipped === 1
        ? vscode.l10n.t(
            "{0} 1 item was left out. See the Python on Viya log for which, and why.",
            summary,
          )
        : vscode.l10n.t(
            "{0} {1} items were left out. See the Python on Viya log for which, and why.",
            summary,
            String(skipped),
          );
  const reveal = vscode.l10n.t("Show in Folder");
  const choice = await vscode.window.showInformationMessage(message, reveal);
  if (choice === reveal) {
    await vscode.commands.executeCommand("revealFileInOS", target);
  }
}

/**
 * Run `work` behind a cancellable notification. Cancel aborts the signal the
 * adapter calls are given; the loops check it between files, so a file
 * already on the wire is abandoned and nothing after it starts.
 */
async function withTransferProgress(
  title: string,
  work: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    signal: AbortSignal,
  ) => Promise<void>,
): Promise<void> {
  await vscode.window.withProgress(
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
        await work(progress, controller.signal);
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

function tooLargeToUpload(): string {
  return vscode.l10n.t(
    "It is larger than the {0} MB SAS Viya accepts for one file.",
    String(MAX_TRANSFER_BYTES / (1024 * 1024)),
  );
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
function transferProblemMessage(problem: ContentProblem): string {
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
  }
}

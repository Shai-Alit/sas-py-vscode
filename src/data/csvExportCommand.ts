// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `vscode`-facing half of `pythonOnViya.exportTableToCsv` — a save
 * dialog, a cancellable progress notification, and a local disk write.
 * `src/data/csvExportModel.ts` owns the actual page-by-page relay this
 * wraps; this file owns everything that touches `vscode` or the local
 * filesystem, mirroring the Model/Panel split `dataViewerModel.ts`/
 * `dataViewerPanel.ts` and `tablePropertiesModel.ts`/`tablePropertiesPanel.ts`
 * already use.
 *
 * **Host-side only, no webview.** The data viewer panel's own CSP
 * (`default-src 'none'`, no `connect-src`) would block an in-panel `fetch`
 * outright, and upstream's own download command bypasses its webview
 * entirely too — a plain command, not a message the panel sends. There is
 * nothing here for a webview to be involved in.
 *
 * **A cancelled or failed export deletes its own partial output file.**
 * Upstream's own `SAS.downloadTable`/`writeTableContentsToStream` calls
 * `fileStream.destroy()` on cancellation and stops — the file it already
 * wrote stays on disk, silently truncated, indistinguishable from a complete
 * export. This project does not repeat that: only a run that reaches the
 * end of the table keeps the file it wrote; anything else removes it.
 *
 * **A pre-flight check estimates the export's size and refuses to start if
 * it will not fit.** {@link ensureDiskSpace} samples a small first page,
 * projects a rough total from it and the table's own `rowCount`, and reads
 * the destination volume's free space (`fs.promises.statfs`) before any
 * page of the real export is written — Sean's own call: better to say so
 * up front than to run out of disk space partway through a large table.
 * This is a safety margin, not a guarantee either way (see that function's
 * own doc comment); the per-write failure path below still catches a real
 * out-of-space error the estimate did not anticipate.
 *
 * **`withProgress`/`showSaveDialog`/the write stream are all injectable**,
 * the same reasoning `ResultPanelDeps.createPanel`/
 * `DataViewerPanelDeps.createPanel`/`ComputeSessionManagerDeps.withProgress`
 * already give for a real `vscode` surface (or, here, a real local
 * filesystem) a test cannot drive reliably.
 *
 * **The fourth file on ADR-0003's Node-built-ins allow-list**
 * (`eslint.config.mjs`), alongside `src/auth/caAgent.ts`. Local-disk
 * streaming writes and a free-space check have no browser-host story either
 * — `vscode.workspace.fs.writeFile` only ever writes one complete buffer, so
 * a large table would have to be held in memory in full first, defeating
 * the reason this feature streams at all — so, like `caAgent.ts`, this is a
 * file a future web build omits rather than reimplements. See ADR-0003's
 * 2026-09-11 amendment.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { type DataResult, type LibraryAdapter } from "./adapter";
import { exportTableToCsv } from "./csvExportModel";
import { localiseDataProblem } from "./messages";
import { describeDataProblem, type DataProblem } from "./problems";
import { type TableDetail, type TableItem } from "./types";
import { abortOn, type CancellationLike } from "../compute/cancellation";

/**
 * The narrow surface of a Node writable stream this module actually writes
 * through — narrowed the same way `DataWebviewPanel` narrows
 * `vscode.WebviewPanel`, so a test double need only implement this much. A
 * real `fs.WriteStream` satisfies it structurally.
 */
export interface CsvOutputStream {
  write(
    chunk: string,
    callback: (error: Error | null | undefined) => void,
  ): void;
  end(callback: () => void): void;
  /** A late write failure this class did not already catch via a `write`/
   * `end` callback — an open failure (bad path, no permission) is the case
   * upstream's own implementation never guards against at all. */
  once(event: "error", listener: (error: Error) => void): void;
}

/** What {@link ensureDiskSpace} reads about the destination volume — narrowed
 * from `fs.StatsFs`'s much larger real shape to the two fields it actually
 * multiplies together. A real `fs.promises.statfs` result satisfies this
 * structurally. */
export interface FreeSpace {
  readonly bavail: number;
  readonly bsize: number;
}

export interface CsvExportDeps {
  /** Defaults to `vscode.window.showSaveDialog`. */
  showSaveDialog?:
    | ((options: vscode.SaveDialogOptions) => Thenable<vscode.Uri | undefined>)
    | undefined;
  /** Defaults to `vscode.window.withProgress`, a cancellable notification. */
  withProgress?:
    | (<T>(
        title: string,
        run: (token: CancellationLike) => Promise<T>,
      ) => Thenable<T>)
    | undefined;
  /** Defaults to `fs.createWriteStream`. */
  createWriteStream?: ((path: string) => CsvOutputStream) | undefined;
  /** Defaults to `fs.promises.unlink`. Best-effort: a failure to remove the
   * partial file (itself already an unusual, secondary failure) is logged,
   * never shown to the user or allowed to mask the export's own error. */
  unlink?: ((path: string) => Promise<void>) | undefined;
  /** Defaults to `fs.promises.statfs` on the destination's own directory —
   * {@link ensureDiskSpace}'s own free-space read. */
  statfs?: ((directory: string) => Promise<FreeSpace>) | undefined;
  readonly log: vscode.LogOutputChannel;
}

/**
 * Rows sampled to project a rough total export size — small enough that
 * sampling costs one cheap extra request even for a huge table, distinct
 * from {@link import("./csvExportModel").CSV_EXPORT_PAGE_SIZE} (the real
 * export's own, larger page size) so this pre-flight check stays cheap
 * regardless of how that constant is tuned.
 */
const SIZE_ESTIMATE_SAMPLE_ROWS = 200;

/**
 * How much headroom {@link ensureDiskSpace} demands beyond its own estimate
 * before letting an export start — the estimate is a projection from a
 * sample, not a measurement of the whole table, so a real table whose later
 * rows run wider than its first {@link SIZE_ESTIMATE_SAMPLE_ROWS} would
 * otherwise pass a check with no margin at all and still run out.
 */
const DISK_SPACE_SAFETY_FACTOR = 1.2;

/**
 * Estimates `table`'s CSV export size from a small first sample and its own
 * `rowCount`, then checks that the destination volume has enough free space
 * for it — Sean's own call (7c-iii): refuse to start an export that is
 * already unlikely to fit, rather than run out of disk space mid-stream.
 *
 * **A safety margin, not a guarantee either way.** The estimate assumes every
 * row is roughly as wide as the sampled ones (real SAS tables are usually
 * fairly regular, but a variable-length string column is not guaranteed to
 * be), and {@link DISK_SPACE_SAFETY_FACTOR} exists because of that
 * uncertainty, not to make the check exact. A table this check passes can
 * still run out for real — {@link runCsvExport}'s own per-write failure
 * handling is what actually catches that, unconditionally.
 *
 * `table.rowCount` absent, or `0`, skips the check entirely — nothing to
 * estimate from and, for `0`, nothing to fit. A `statfs` failure (an unusual
 * filesystem this project has not seen) does the same rather than blocking a
 * real export over a check that itself could not run.
 */
async function ensureDiskSpace(
  adapter: LibraryAdapter,
  table: TableDetail,
  destinationPath: string,
  statfs: (directory: string) => Promise<FreeSpace>,
  signal: AbortSignal,
): Promise<DataResult<void>> {
  const rowCount = table.rowCount;
  if (rowCount === undefined || rowCount === 0) {
    return { ok: true, value: undefined };
  }

  const sampleLimit = Math.min(SIZE_ESTIMATE_SAMPLE_ROWS, rowCount);
  const sample = await adapter.getRowsAsCsv(
    table,
    { start: 0, limit: sampleLimit },
    true,
    undefined,
    signal,
  );
  if (!sample.ok) return sample;

  // `.length` (UTF-16 code units), not a true byte count: real SAS table
  // text is overwhelmingly ASCII/Latin-1, where the two agree closely enough
  // for a safety-margined estimate — this is deliberately not exact.
  const sampleSize = sample.value.length;
  const estimatedBytes =
    sampleLimit >= rowCount
      ? sampleSize // the sample already is the whole table
      : Math.ceil((sampleSize / sampleLimit) * rowCount);

  let available: number;
  try {
    const stats = await statfs(path.dirname(destinationPath));
    available = stats.bavail * stats.bsize;
  } catch {
    return { ok: true, value: undefined };
  }

  if (estimatedBytes * DISK_SPACE_SAFETY_FACTOR > available) {
    return {
      ok: false,
      reason: "not enough free disk space for the estimated export size",
      problem: {
        code: "insufficient-disk-space",
        estimatedBytes,
        availableBytes: available,
      },
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Runs `pythonOnViya.exportTableToCsv` for `item`: a save dialog, then a
 * cancellable progress notification that opens the table
 * (`LibraryAdapter.openTable`) and streams its rows to the chosen file
 * (`exportTableToCsv`, `src/data/csvExportModel.ts`). A dismissed save
 * dialog (`uri === undefined`) is a silent no-op — the user changed their
 * mind, not a failure to report.
 */
export async function runCsvExport(
  item: TableItem,
  adapter: LibraryAdapter,
  deps: CsvExportDeps,
): Promise<void> {
  const showSaveDialog = deps.showSaveDialog ?? vscode.window.showSaveDialog;
  const defaultName = `${item.libref}.${item.name}.csv`.toLowerCase();
  const uri = await showSaveDialog({
    defaultUri: vscode.Uri.file(defaultName),
    filters: { CSV: ["csv"] },
  });
  if (uri === undefined) return;

  const withProgress = deps.withProgress ?? realWithProgress;
  const createWriteStream =
    deps.createWriteStream ??
    ((filePath: string) => fs.createWriteStream(filePath));
  const unlink =
    deps.unlink ?? ((filePath: string) => fs.promises.unlink(filePath));
  const statfs =
    deps.statfs ?? ((directory: string) => fs.promises.statfs(directory));

  await withProgress(
    vscode.l10n.t(
      'Exporting "{0}.{1}" to {2}…',
      item.libref,
      item.name,
      uri.fsPath,
    ),
    async (token) => {
      const bridge = abortOn(token);
      const stream = createWriteStream(uri.fsPath);
      let streamError: Error | undefined;
      stream.once("error", (error) => {
        streamError ??= error;
      });
      let succeeded = false;

      try {
        const opened = await adapter.openTable(item, bridge.signal);
        if (!opened.ok) {
          report(deps.log, item, opened.problem, bridge.signal.aborted);
          return;
        }

        const spaceCheck = await ensureDiskSpace(
          adapter,
          opened.value,
          uri.fsPath,
          statfs,
          bridge.signal,
        );
        if (!spaceCheck.ok) {
          report(deps.log, item, spaceCheck.problem, bridge.signal.aborted);
          return;
        }

        const result = await exportTableToCsv(
          adapter,
          opened.value,
          (chunk) => writeChunk(stream, chunk, () => streamError),
          bridge.signal,
        );
        if (!result.ok) {
          report(deps.log, item, result.problem, bridge.signal.aborted);
          return;
        }

        if (streamError !== undefined) throw streamError;
        succeeded = true;
      } catch (error) {
        if (!bridge.signal.aborted) {
          const message = messageOf(error);
          deps.log.error(
            vscode.l10n.t(
              'SAS Libraries: could not export "{0}.{1}" to CSV ({2})',
              item.libref,
              item.name,
              message,
            ),
          );
          void vscode.window.showErrorMessage(
            vscode.l10n.t("Exporting the table failed: {0}", message),
          );
        }
      } finally {
        bridge.dispose();
        await endStream(stream);
        if (!succeeded) {
          await unlink(uri.fsPath).catch((error: unknown) => {
            deps.log.debug(
              vscode.l10n.t(
                "SAS Libraries: could not remove the incomplete export file {0} ({1})",
                uri.fsPath,
                messageOf(error),
              ),
            );
          });
        }
      }
    },
  );
}

function report(
  log: vscode.LogOutputChannel,
  item: TableItem,
  problem: DataProblem,
  aborted: boolean,
): void {
  if (aborted) return;
  log.error(
    vscode.l10n.t(
      'SAS Libraries: could not export "{0}.{1}" to CSV ({2})',
      item.libref,
      item.name,
      describeDataProblem(problem),
    ),
  );
  void vscode.window.showErrorMessage(localiseDataProblem(problem));
}

function realWithProgress<T>(
  title: string,
  run: (token: CancellationLike) => Promise<T>,
): Thenable<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (_progress, token) => await run(token),
  );
}

function writeChunk(
  stream: CsvOutputStream,
  chunk: string,
  currentStreamError: () => Error | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      const failure = error ?? currentStreamError();
      if (failure) reject(failure);
      else resolve();
    });
  });
}

function endStream(stream: CsvOutputStream): Promise<void> {
  return new Promise((resolve) => {
    stream.end(() => {
      resolve();
    });
  });
}

/** The message of a thrown value, and nothing else it might be carrying — the
 * same small helper `compute/client.ts`/`dataViewerPanel.ts`/
 * `tablePropertiesPanel.ts` each carry their own copy of. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

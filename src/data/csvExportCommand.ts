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
 * **Writes to a temporary file next to the destination, and only renames it
 * onto the destination on full success.** Upstream's own `SAS.downloadTable`/
 * `writeTableContentsToStream` opens the destination file directly — which
 * both truncates it immediately (before a single row has been confirmed to
 * fit) and calls `fileStream.destroy()` on cancellation and stops, leaving
 * whatever was already written on disk, silently truncated, indistinguishable
 * from a complete export. Writing under a `.tmp` name first and renaming only
 * once {@link exportTableToCsv} has returned success means a cancelled or
 * failed run never touches a destination the user already had — an existing
 * file the save dialog is pointed at survives untouched — and removes only
 * its own temporary file. `fs.promises.rename` on the same directory is
 * atomic on every filesystem this project runs on, so there is no window
 * where the destination is a half-written file.
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
 * **The fifth file on ADR-0003's Node-built-ins allow-list**
 * (`eslint.config.mjs`), alongside `src/auth/caAgent.ts`. Local-disk
 * streaming writes and a free-space check have no browser-host story either
 * — `vscode.workspace.fs.writeFile` only ever writes one complete buffer, so
 * a large table would have to be held in memory in full first, defeating
 * the reason this feature streams at all — so, like `caAgent.ts`, this is a
 * file a future web build omits rather than reimplements. See ADR-0003's
 * 2026-09-11 amendment.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import * as vscode from "vscode";

import { type LibraryAdapter } from "./adapter";
import {
  type CsvExportFailure,
  type CsvExportResult,
  type CsvExportSource,
} from "./csvExportModel";
import { LibraryCsvSource } from "./libraryCsvSource";
import { localiseDataProblem } from "./messages";
import { describeDataProblem, type DataProblem } from "./problems";
import { type TableItem } from "./types";
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
  /** Defaults to `fs.promises.rename` — the temporary file onto the real
   * destination, on full success only. */
  rename?: ((from: string, to: string) => Promise<void>) | undefined;
  /** Defaults to `fs.promises.unlink`. Best-effort: a failure to remove the
   * temporary file (itself already an unusual, secondary failure) is logged,
   * never shown to the user or allowed to mask the export's own error. */
  unlink?: ((path: string) => Promise<void>) | undefined;
  /** Defaults to `fs.promises.statfs` on the destination's own directory —
   * {@link ensureDiskSpace}'s own free-space read. */
  statfs?: ((directory: string) => Promise<FreeSpace>) | undefined;
  /** Defaults to a modal warning with an "Export anyway" button. Asked only
   * for a source that names a `confirmAboveBytes` threshold and only when the
   * pre-flight estimate exceeds it; resolves `true` to go ahead. */
  confirmLargeExport?:
    | ((
        estimatedBytes: number,
        rowCount: number | undefined,
      ) => Thenable<boolean>)
    | undefined;
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
 * Estimates the export's total CSV size from a small first sample and the
 * table's own row count — the shared basis of {@link ensureDiskSpace} and the
 * large-export confirmation. `undefined` when there is nothing to estimate
 * from (no row count, or an empty table).
 *
 * The estimate assumes every row is roughly as wide as the sampled ones (real
 * tables are usually fairly regular, but a variable-length string column is
 * not guaranteed to be), so callers treat it as a margin, not a measurement.
 */
async function estimateExportBytes(
  source: CsvExportSource,
  rowCount: number | undefined,
  signal: AbortSignal,
): Promise<CsvExportResult<number | undefined>> {
  if (rowCount === undefined || rowCount === 0) {
    return { ok: true, value: undefined };
  }

  const sampleLimit = Math.min(SIZE_ESTIMATE_SAMPLE_ROWS, rowCount);
  const sample = await source.sample(sampleLimit, signal);
  if (!sample.ok) return sample;

  // `.length` (UTF-16 code units), not a true byte count: real table text is
  // overwhelmingly ASCII/Latin-1, where the two agree closely enough for a
  // safety-margined estimate — this is deliberately not exact.
  const sampleSize = sample.value.length;
  return {
    ok: true,
    value:
      sampleLimit >= rowCount
        ? sampleSize // the sample already is the whole table
        : Math.ceil((sampleSize / sampleLimit) * rowCount),
  };
}

/**
 * Checks that the destination volume has room for `estimatedBytes` — Sean's
 * own call (7c-iii): refuse to start an export that is already unlikely to
 * fit, rather than run out of disk space mid-stream.
 *
 * **A safety margin, not a guarantee either way.**
 * {@link DISK_SPACE_SAFETY_FACTOR} exists because the estimate is uncertain,
 * not to make the check exact. A table this check passes can still run out
 * for real — {@link runSourceCsvExport}'s own per-write failure handling is
 * what actually catches that, unconditionally.
 *
 * A `statfs` failure (an unusual filesystem this project has not seen) skips
 * the check rather than blocking a real export over a check that itself could
 * not run.
 */
async function ensureDiskSpace(
  estimatedBytes: number,
  destinationPath: string,
  statfs: (directory: string) => Promise<FreeSpace>,
): Promise<CsvExportResult<void>> {
  let available: number;
  try {
    const stats = await statfs(path.dirname(destinationPath));
    available = stats.bavail * stats.bsize;
  } catch {
    return { ok: true, value: undefined };
  }

  if (estimatedBytes * DISK_SPACE_SAFETY_FACTOR > available) {
    return fromDataProblem({
      code: "insufficient-disk-space",
      estimatedBytes,
      availableBytes: available,
    });
  }
  return { ok: true, value: undefined };
}

/**
 * Runs `pythonOnViya.exportTableToCsv` for a SAS library table — see
 * {@link runSourceCsvExport}, which this only adapts `item`/`adapter` into.
 * `guardFormulaInjection` (12e, `pythonOnViya.csvExport.
 * guardFormulaInjection`, off by default) is the caller's job to read from
 * configuration — this function stays free of `vscode.workspace` reads the
 * same way every other seam here is kept injectable/testable.
 */
export async function runCsvExport(
  item: TableItem,
  adapter: LibraryAdapter,
  deps: CsvExportDeps,
  guardFormulaInjection = false,
): Promise<void> {
  await runSourceCsvExport(
    new LibraryCsvSource(item, adapter, guardFormulaInjection),
    deps,
  );
}

/**
 * Runs a CSV export for `source`: a save dialog, then a cancellable progress
 * notification that opens the table and streams its rows to a temporary file
 * next to the chosen destination, renaming it onto the destination only once
 * that streaming completes successfully. A dismissed save dialog
 * (`uri === undefined`) is a silent no-op — the user changed their mind, not
 * a failure to report — and so is a declined large-export confirmation.
 */
export async function runSourceCsvExport(
  source: CsvExportSource,
  deps: CsvExportDeps,
): Promise<void> {
  const showSaveDialog = deps.showSaveDialog ?? vscode.window.showSaveDialog;
  const defaultName = `${source.name}.csv`.toLowerCase();
  const uri = await showSaveDialog({
    defaultUri: vscode.Uri.file(defaultName),
    filters: { CSV: ["csv"] },
  });
  if (uri === undefined) return;

  const withProgress = deps.withProgress ?? realWithProgress;
  const createWriteStream =
    deps.createWriteStream ??
    ((filePath: string) => fs.createWriteStream(filePath));
  const rename =
    deps.rename ?? ((from: string, to: string) => fs.promises.rename(from, to));
  const unlink =
    deps.unlink ?? ((filePath: string) => fs.promises.unlink(filePath));
  const statfs =
    deps.statfs ?? ((directory: string) => fs.promises.statfs(directory));

  // Distinct per run (not just per destination): two exports racing to the
  // same destination — unlikely, but not impossible if a user fires the
  // command twice — must not fight over one temporary file.
  const tempPath = `${uri.fsPath}.${randomUUID()}.tmp`;

  await withProgress(
    vscode.l10n.t('Exporting "{0}" to {1}…', source.name, uri.fsPath),
    async (token) => {
      const bridge = abortOn(token);
      let succeeded = false;
      // Set once `createWriteStream` actually runs (below) — a table this
      // run never gets as far as reading (a gone session, an
      // `insufficient-disk-space` refusal) creates no temporary file at all,
      // not even a fleeting empty one, and the `finally` block's own cleanup
      // must not try to remove one that was never made.
      let tempFileCreated = false;
      // `undefined` until `createWriteStream` actually runs. Declared outside
      // the `try` regardless, so a stream that fails even to open (a bad
      // path, a permissions error) is still reported the same way any other
      // failure here is, and `bridge.dispose()` below still runs either way.
      let stream: CsvOutputStream | undefined;

      try {
        const opened = await source.open(bridge.signal);
        if (!opened.ok) {
          report(deps.log, source, opened, bridge.signal.aborted);
          return;
        }

        const estimate = await estimateExportBytes(
          source,
          opened.value.rowCount,
          bridge.signal,
        );
        if (!estimate.ok) {
          report(deps.log, source, estimate, bridge.signal.aborted);
          return;
        }

        const estimatedBytes = estimate.value;
        if (estimatedBytes !== undefined) {
          // Asked before the disk check: there is no point telling someone
          // there is not enough room for an export they were about to decline.
          const threshold = source.confirmAboveBytes;
          if (threshold !== undefined && estimatedBytes > threshold) {
            const proceed = await confirmLargeExport(
              source,
              estimatedBytes,
              opened.value.rowCount,
              deps,
            );
            if (!proceed) return;
          }

          const spaceCheck = await ensureDiskSpace(
            estimatedBytes,
            uri.fsPath,
            statfs,
          );
          if (!spaceCheck.ok) {
            report(deps.log, source, spaceCheck, bridge.signal.aborted);
            return;
          }
        }

        const openedStream = createWriteStream(tempPath);
        stream = openedStream;
        tempFileCreated = true;
        let streamError: Error | undefined;
        openedStream.once("error", (error) => {
          streamError ??= error;
        });

        const result = await source.stream(
          (chunk) => writeChunk(openedStream, chunk, () => streamError),
          bridge.signal,
        );
        if (!result.ok) {
          report(deps.log, source, result, bridge.signal.aborted);
          return;
        }

        await endStream(openedStream);
        stream = undefined; // already ended — the `finally` below must not end it again
        // Checked only now, after the flush: a real disk failure can surface
        // only once the stream's internal buffer is finally written out,
        // which can land after every `write` callback already resolved
        // cleanly — checking any earlier would miss exactly that case.
        if (streamError !== undefined) throw streamError;

        await rename(tempPath, uri.fsPath);
        succeeded = true;
      } catch (error) {
        if (!bridge.signal.aborted) {
          const message = messageOf(error);
          deps.log.error(
            vscode.l10n.t(
              '{0}: could not export "{1}" to CSV ({2})',
              source.logPrefix,
              source.name,
              message,
            ),
          );
          void vscode.window.showErrorMessage(
            vscode.l10n.t("Exporting the table failed: {0}", message),
          );
        }
      } finally {
        bridge.dispose();
        if (stream !== undefined) await endStream(stream);
        if (!succeeded && tempFileCreated) {
          await unlink(tempPath).catch((error: unknown) => {
            deps.log.debug(
              vscode.l10n.t(
                "{0}: could not remove the incomplete export file {1} ({2})",
                source.logPrefix,
                tempPath,
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
  source: CsvExportSource,
  failure: CsvExportFailure,
  aborted: boolean,
): void {
  if (aborted) return;
  log.error(
    vscode.l10n.t(
      '{0}: could not export "{1}" to CSV ({2})',
      source.logPrefix,
      source.name,
      failure.logDetail,
    ),
  );
  void vscode.window.showErrorMessage(failure.message);
}

/** A library-side {@link DataProblem} as the command's own failure shape —
 * the one place this file's `insufficient-disk-space` refusal is turned into
 * text. */
function fromDataProblem(problem: DataProblem): CsvExportFailure {
  return {
    ok: false,
    message: localiseDataProblem(problem),
    logDetail: describeDataProblem(problem),
  };
}

/** The modal "this is a big download" confirmation. */
async function confirmLargeExport(
  source: CsvExportSource,
  estimatedBytes: number,
  rowCount: number | undefined,
  deps: CsvExportDeps,
): Promise<boolean> {
  if (deps.confirmLargeExport !== undefined) {
    return await deps.confirmLargeExport(estimatedBytes, rowCount);
  }
  const exportAnyway = vscode.l10n.t("Export anyway");
  const megabytes = Math.round(estimatedBytes / (1024 * 1024)).toLocaleString();
  const choice = await vscode.window.showWarningMessage(
    rowCount === undefined
      ? vscode.l10n.t(
          '"{0}" is large: about {1} MB as CSV. Exporting downloads every row over your connection and can take a long time. Export it anyway?',
          source.name,
          megabytes,
        )
      : vscode.l10n.t(
          '"{0}" is large: {1} rows, about {2} MB as CSV. Exporting downloads every row over your connection and can take a long time. Export it anyway?',
          source.name,
          rowCount.toLocaleString(),
          megabytes,
        ),
    { modal: true },
    exportAnyway,
  );
  return choice === exportAnyway;
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

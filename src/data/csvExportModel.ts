// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Streams a table's full row set to a caller-supplied sink as CSV text —
 * 7c-iii, the local-disk-write feature `pythonOnViya.exportTableToCsv`
 * (`src/data/csvExportCommand.ts`) adds.
 *
 * **This module must never import `vscode`.**
 *
 * Finding 7.20 (`docs/phases/phase-7.md`) is why this is a straight,
 * page-by-page relay rather than upstream's own approach
 * (`LibraryModel.writeTableContentsToStream`): upstream's own `getRowsAsCSV`
 * never actually reaches a CSV response at all — its hand-composed
 * `.../rows#CSV` URL loses the `#CSV` fragment before the wire ever sees it,
 * so the request that actually goes out is a plain, unheadered `GET .../rows`,
 * and upstream's client silently falls back to the JSON envelope and
 * re-serializes each row into CSV text itself, with a hand-rolled quoting
 * scheme that wraps every field in quotes unconditionally, comma or not. This
 * project's own `rowsAsCSV` link (`LibraryAdapter.getRowsAsCsv`) reaches a
 * real server-side CSV response instead, already RFC-4180-quoted (Finding
 * 7.20's own comma/embedded-quote/embedded-newline probe) — so this module
 * writes each page's raw response text straight through, with no
 * re-serialization of its own.
 *
 * **Termination is "the server answered with an empty body", not a row-count
 * comparison.** Finding 7.20: a page requested past the end of the table
 * comes back `200` with a zero-byte body, not an error — so this loop simply
 * keeps requesting the next `limit`-sized window until it sees one, rather
 * than needing (or trusting) a `rowCount` carried over from wherever the
 * caller's `TableDetail` came from.
 *
 * **Deliberately unbounded, unlike {@link
 * import("./adapter").LibraryAdapter}'s own `collectPages`/`MAX_DATA_PAGES`
 * guard.** That guard exists because a `next` link this project did not
 * construct could, in principle, cycle forever. This loop's own `start` is
 * entirely self-derived (`start += CSV_EXPORT_PAGE_SIZE` every iteration,
 * never a server-supplied link), so it cannot cycle — and a hard page cap
 * here would silently truncate a real user's large table export, which is a
 * correctness bug this feature exists to avoid, not a safety net worth
 * having.
 */

import {
  type DataFailure,
  type DataResult,
  type LibraryAdapter,
  type RowWindow,
} from "./adapter";
import { type TableDetail } from "./types";

/**
 * Rows requested per page — comfortably under the transport's 1 MiB
 * response-body cap (`src/auth/transport.ts`'s `MAX_BODY_BYTES`) for any
 * realistically wide table, while keeping the round-trip count low for a
 * large one. Not measured against a specific real table's row width; a table
 * wide enough to still exceed the cap at this page size fails the read
 * (`src/auth/transport.ts`'s `ResponseTooLargeError`), not a silent
 * truncation; only `src/content/client.ts` turns that into a dedicated
 * `content-too-large` problem, so here it is reported as a generic
 * request failure.
 */
export const CSV_EXPORT_PAGE_SIZE = 500;

/**
 * Writes one already-encoded chunk of CSV text to wherever this export is
 * headed. Resolves once the sink is ready for the next chunk; rejects on a
 * write failure (disk full, permission denied) so the export loop stops
 * rather than continuing to fetch pages nothing will keep.
 */
export type CsvSink = (chunk: string) => Promise<void>;

/** A failed export step in the form the command layer reports — both
 * strings already produced by whichever backend owns the failure, matching
 * `TableSourceResult`'s own two-string shape (`./tableSource.ts`): `message`
 * is a complete localised sentence for the user, `logDetail` the untranslated
 * fragment written to the output channel. */
export interface CsvExportFailure {
  readonly ok: false;
  readonly message: string;
  readonly logDetail: string;
}

export type CsvExportResult<T> =
  { readonly ok: true; readonly value: T } | CsvExportFailure;

/**
 * What `runCsvExport` (`./csvExportCommand.ts`) needs from a table's own
 * backend — the seam 11d added so the one command (save dialog, progress,
 * temp-file-then-rename, disk-space pre-flight) serves both a SAS library
 * table and a CAS table. A source is bound to one already-identified table.
 */
export interface CsvExportSource {
  /** The table's qualified display name, for the progress title and every
   * message (`SASHELP.CLASS`, `MYCASLIB.SALES`). */
  readonly name: string;
  /** Named in every log line — "SAS Libraries" or "CAS", matching the tree the
   * table was chosen from. */
  readonly logPrefix: string;
  /** When set, an export estimated to exceed this many bytes is confirmed
   * with the user before it starts. Absent means never ask — a SAS library
   * table's own export sets none yet (`docs/phases/phase-11.md`). */
  readonly confirmAboveBytes?: number | undefined;
  /** Resolves whatever must be opened before rows can be read; called once,
   * first. `rowCount` is the backend's best knowledge of the table's size,
   * for the disk-space and large-export pre-flight checks. */
  open(
    signal?: AbortSignal,
  ): Promise<CsvExportResult<{ readonly rowCount: number | undefined }>>;
  /** The first `limit` rows as CSV text, header included — the disk-space
   * pre-flight's sample. */
  sample(limit: number, signal?: AbortSignal): Promise<CsvExportResult<string>>;
  /** Streams every row to `sink`; see {@link streamCsvPages}. */
  stream(sink: CsvSink, signal?: AbortSignal): Promise<CsvExportResult<void>>;
}

/** Reads one window of CSV text — `includeHeader` is true only for the first
 * page. Resolves `""` once the window is past the end of the table. */
export type CsvPageReader<F extends { readonly ok: false }> = (
  window: RowWindow,
  includeHeader: boolean,
  signal?: AbortSignal,
) => Promise<{ readonly ok: true; readonly value: string } | F>;

/**
 * Streams a whole table to `sink` one `pageSize`-row window at a time, asking
 * `read` for each — see this module's own doc comment for why a page boundary
 * needs no separator of its own and why the loop has no page-count ceiling.
 * Generic over the failure shape so a Library reader's `DataResult` and a
 * CAS reader's own both pass through untouched.
 *
 * `signal`, when given, cancels the in-flight page request; the sink itself is
 * not aborted here — closing the underlying stream is the caller's own job.
 */
export async function streamCsvPages<F extends { readonly ok: false }>(
  read: CsvPageReader<F>,
  pageSize: number,
  sink: CsvSink,
  signal?: AbortSignal,
): Promise<{ readonly ok: true; readonly value: undefined } | F> {
  let start = 0;
  let first = true;

  for (;;) {
    const page = await read({ start, limit: pageSize }, first, signal);
    if (!page.ok) return page;
    if (page.value === "") break;

    await sink(page.value);
    first = false;
    start += pageSize;
  }

  return { ok: true, value: undefined };
}

/**
 * Streams `table`'s full row set to `sink` as CSV text, one page at a time —
 * the SAS-library specialisation of {@link streamCsvPages}: each page is the
 * server's own `rowsAsCSV` response, relayed untouched.
 */
export async function exportTableToCsv(
  adapter: LibraryAdapter,
  table: TableDetail,
  sink: CsvSink,
  signal?: AbortSignal,
): Promise<DataResult<void>> {
  return await streamCsvPages<DataFailure>(
    (window, first, pageSignal) =>
      adapter.getRowsAsCsv(table, window, first, undefined, pageSignal),
    CSV_EXPORT_PAGE_SIZE,
    sink,
    signal,
  );
}

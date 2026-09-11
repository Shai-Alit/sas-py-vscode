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
 * wide enough to still exceed the cap at this page size surfaces as the same
 * `content-too-large` failure any other oversized read in this project
 * already does (`src/auth/transport.ts`'s `ResponseTooLargeError`), not a
 * silent truncation.
 */
export const CSV_EXPORT_PAGE_SIZE = 500;

/**
 * Writes one already-encoded chunk of CSV text to wherever this export is
 * headed. Resolves once the sink is ready for the next chunk; rejects on a
 * write failure (disk full, permission denied) so the export loop stops
 * rather than continuing to fetch pages nothing will keep.
 */
export type CsvSink = (chunk: string) => Promise<void>;

/**
 * Streams `table`'s full row set to `sink` as CSV text, one page at a time —
 * see this module's own doc comment for why a page boundary needs no
 * separator of its own and why the loop has no page-count ceiling.
 *
 * `signal`, when given, cancels the in-flight page request the same way
 * every other `LibraryAdapter` call already honours one; the sink itself is
 * not aborted here — closing the underlying stream is the caller's own job.
 */
export async function exportTableToCsv(
  adapter: LibraryAdapter,
  table: TableDetail,
  sink: CsvSink,
  signal?: AbortSignal,
): Promise<DataResult<void>> {
  let start = 0;
  let first = true;

  for (;;) {
    const window: RowWindow = { start, limit: CSV_EXPORT_PAGE_SIZE };
    const page = await adapter.getRowsAsCsv(
      table,
      window,
      first,
      undefined,
      signal,
    );
    if (!page.ok) return page;
    if (page.value === "") break;

    await sink(page.value);
    first = false;
    start += CSV_EXPORT_PAGE_SIZE;
  }

  return { ok: true, value: undefined };
}

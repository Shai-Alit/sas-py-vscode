// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `runCsvExport` (`src/data/csvExportCommand.ts`, 7c-iii) against a fake save
 * dialog, a fake write stream, and a **real** `LibraryAdapter` wired to
 * recorded `DataAccessApi` fixtures — the same shape
 * `table-properties-panel.test.ts`/`data-viewer-panel.test.ts` already use.
 *
 * This is an integration test, not a unit one, because `csvExportCommand.ts`
 * imports `vscode` (`.c8rc.json` excludes it from unit coverage for exactly
 * that reason) — the pagination loop it wraps is unit-tested directly in
 * `test/unit/data-csv-export-model.test.ts`, and `LibraryAdapter` itself in
 * `test/unit/data-adapter.test.ts`. This file's own job is the save
 * dialog/progress/cancellation/local-disk-write wiring around that loop.
 */

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  LibraryAdapter,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../../src/data/adapter";
import {
  runCsvExport,
  type CsvOutputStream,
  type FreeSpace,
} from "../../../src/data/csvExportCommand";
import { type TableItem } from "../../../src/data/types";
import {
  dataCsv,
  dataFail,
  dataFixture,
  recordedDataClient,
  type RecordedDataRoute,
} from "../../helpers/recorded-data";
import type { ComputeSession } from "../../../src/compute/session";

const SESSION_ID = "aaaaaaaa-0000-4000-8000-000000000001-ses0000";
const LIBREFS_HREF = `/compute/sessions/${SESSION_ID}/data`;
const CLASS_HREF = `${LIBREFS_HREF}/SASHELP/CLASS`;
const PROFILE_ID = "profile-1";
// `vscode.Uri.file` normalises a Windows path (lower-cased drive letter,
// backslashes) on its own `.fsPath` — built once here and read back through
// `SAVE_URI.fsPath` everywhere a test compares against what `runCsvExport`
// itself received, rather than against this literal's own original casing.
const SAVE_URI = vscode.Uri.file("C:/exports/sashelp.class.csv");
// `table-detail-class.json`'s own `rowCount` (Finding 7.19) — `ensureDiskSpace`
// samples `Math.min(SIZE_ESTIMATE_SAMPLE_ROWS, rowCount)` rows before the real
// export loop starts, so every route list below that opens the table
// successfully also needs this one.
const DISK_SPACE_SAMPLE_ROUTE: RecordedDataRoute = {
  when: `${CLASS_HREF}/rows?start=0&limit=19&includeColumnNames=true`,
  reply: dataCsv("Name,Sex\nAlfred,M\n"),
};

/** A `statfs` fake reporting ample free space, so a test exercising the
 * "space check passes" path does not depend on whatever a real
 * `fs.promises.statfs` happens to report for wherever this suite runs. */
function ampleDiskSpace(): (directory: string) => Promise<FreeSpace> {
  return () => Promise.resolve({ bavail: 1_000_000_000, bsize: 4096 });
}

/** Same shape `data-viewer-panel.test.ts`/`table-properties-panel.test.ts`
 * each build, duplicated for the same reason those files' own comments
 * give. */
function tableItem(): TableItem {
  return {
    kind: "table",
    libref: "SASHELP",
    name: "CLASS",
    readOnly: true,
    links: [
      {
        rel: "self",
        href: CLASS_HREF,
        method: "GET",
        type: "application/vnd.sas.compute.data.table",
      },
    ],
  };
}

function libraryAdapter(routes: readonly RecordedDataRoute[]): LibraryAdapter {
  const { client } = recordedDataClient(routes);
  const session: ComputeSession = { id: SESSION_ID, state: "idle", links: [] };
  const sessions: LibrarySessionSource = {
    isBusy: () => false,
    current: (): ConnectedSession | undefined => ({ client, session }),
  };
  return new LibraryAdapter(sessions, PROFILE_ID);
}

/** `openTable`'s own route — `table-detail-class.json` already carries a
 * `rowsAsCSV` link (Findings 7.15/7.20). */
const OPEN_ROUTE: RecordedDataRoute = {
  when: CLASS_HREF,
  reply: dataFixture("table-detail-class.json"),
};

/** A mutable record `fakeStream` writes into — plain fields, not getters, so
 * a test that destructures the return value before `runCsvExport` runs still
 * observes what happens to the stream afterward rather than a snapshot taken
 * before any of it happened. */
interface FakeStreamState {
  readonly chunks: string[];
  ended: boolean;
}

/** A fake `CsvOutputStream` that records every chunk it is given instead of
 * touching the real filesystem — the same reasoning `DataViewerPanelDeps.
 * createPanel` gives for a real `vscode` surface a test cannot drive
 * reliably, applied here to a real local file.
 *
 * `errorDuringEnd`, when given, fires the registered `"error"` listener
 * right before `end`'s own callback — simulating a real disk failure
 * (`ENOSPC`) that surfaces only once the stream's internal buffer is finally
 * flushed, after every earlier `write` callback already resolved cleanly.
 * This is the specific ordering `runCsvExport`'s own post-flush `streamError`
 * check exists for. */
function fakeStream(options?: { errorDuringEnd?: Error }): {
  stream: CsvOutputStream;
  state: FakeStreamState;
} {
  const state: FakeStreamState = { chunks: [], ended: false };
  let errorListener: ((error: Error) => void) | undefined;
  const stream: CsvOutputStream = {
    write: (chunk, callback) => {
      state.chunks.push(chunk);
      callback(undefined);
    },
    end: (callback) => {
      state.ended = true;
      if (options?.errorDuringEnd !== undefined) {
        errorListener?.(options.errorDuringEnd);
      }
      callback();
    },
    once: (_event, listener) => {
      errorListener = listener;
    },
  };
  return { stream, state };
}

/** Tracks every `createWriteStream`/`rename`/`unlink` call `runCsvExport`
 * makes, all answering as fake filesystem successes — `stream` is the one
 * `createWriteStream` always hands back, so a test can assert on the same
 * `FakeStreamState` it already holds. */
interface FakeFsOps {
  readonly createWriteStream: (path: string) => CsvOutputStream;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
  readonly createdPaths: string[];
  readonly renamed: { from: string; to: string }[];
  readonly unlinked: string[];
}

function fakeFsOps(stream: CsvOutputStream): FakeFsOps {
  const createdPaths: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  const unlinked: string[] = [];
  return {
    createdPaths,
    renamed,
    unlinked,
    createWriteStream: (path) => {
      createdPaths.push(path);
      return stream;
    },
    rename: (from, to) => {
      renamed.push({ from, to });
      return Promise.resolve();
    },
    unlink: (path) => {
      unlinked.push(path);
      return Promise.resolve();
    },
  };
}

function fakeLog(): { log: vscode.LogOutputChannel; errors: string[] } {
  const errors: string[] = [];
  const log = {
    error: (message: string) => errors.push(message),
    debug: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  return { log, errors };
}

/** Runs `body` with `vscode.window.showErrorMessage` stubbed to record its
 * calls, restoring it afterwards — the same helper
 * `content/dragAndDrop.test.ts` uses for the identical reason. */
async function withErrorMessageStub(
  body: (shown: string[]) => Promise<void>,
): Promise<void> {
  const shown: string[] = [];
  const original = vscode.window.showErrorMessage;
  (vscode.window as { showErrorMessage: unknown }).showErrorMessage = (
    message: string,
  ) => {
    shown.push(message);
    return Promise.resolve(undefined);
  };
  try {
    await body(shown);
  } finally {
    (vscode.window as { showErrorMessage: unknown }).showErrorMessage =
      original;
  }
}

describe("runCsvExport", () => {
  it("writes every page to a temporary file, then renames it onto the destination on a full export", async () => {
    await withErrorMessageStub(async (shown) => {
      const { stream, state } = fakeStream();
      const ops = fakeFsOps(stream);
      const { log, errors } = fakeLog();
      const adapter = libraryAdapter([
        OPEN_ROUTE,
        DISK_SPACE_SAMPLE_ROUTE,
        {
          when: `${CLASS_HREF}/rows?start=0&limit=500&includeColumnNames=true`,
          reply: dataCsv("Name,Sex\nAlfred,M\n"),
        },
        {
          when: `${CLASS_HREF}/rows?start=500&limit=500`,
          reply: dataCsv(""),
        },
      ]);

      await runCsvExport(tableItem(), adapter, {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: ops.createWriteStream,
        rename: ops.rename,
        unlink: ops.unlink,
        statfs: ampleDiskSpace(),
      });

      assert.deepEqual(state.chunks, ["Name,Sex\nAlfred,M\n"]);
      assert.ok(state.ended);
      // Written under a temporary name next to the destination, not the
      // destination itself — this module's own "no truncated destination"
      // guarantee depends on this.
      assert.equal(ops.createdPaths.length, 1);
      const [tempPath] = ops.createdPaths;
      assert.ok(tempPath);
      assert.notEqual(tempPath, SAVE_URI.fsPath);
      assert.ok(tempPath.startsWith(SAVE_URI.fsPath));
      assert.deepEqual(ops.renamed, [{ from: tempPath, to: SAVE_URI.fsPath }]);
      assert.deepEqual(ops.unlinked, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(shown, []);
    });
  });

  it("does nothing when the save dialog is dismissed", async () => {
    const { log, errors } = fakeLog();
    // No routes at all — a call the adapter would make throws, so an
    // unexpected request here fails the test rather than passing silently.
    const adapter = libraryAdapter([]);
    let createdStream = false;

    await runCsvExport(tableItem(), adapter, {
      log,
      showSaveDialog: () => Promise.resolve(undefined),
      createWriteStream: () => {
        createdStream = true;
        return fakeStream().stream;
      },
    });

    assert.equal(createdStream, false);
    assert.deepEqual(errors, []);
  });

  it("reports and cleans up its temporary file, leaving the destination untouched, when opening the table fails", async () => {
    await withErrorMessageStub(async (shown) => {
      const { stream, state } = fakeStream();
      const ops = fakeFsOps(stream);
      const { log, errors } = fakeLog();
      const adapter = libraryAdapter([
        {
          when: CLASS_HREF,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]);

      await runCsvExport(tableItem(), adapter, {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: ops.createWriteStream,
        rename: ops.rename,
        unlink: ops.unlink,
      });

      assert.ok(state.ended);
      assert.deepEqual(ops.renamed, []);
      assert.deepEqual(ops.unlinked, ops.createdPaths);
      assert.equal(errors.length, 1);
      assert.equal(shown.length, 1);
    });
  });

  it("refuses to start, and cleans up, when the estimated export will not fit", async () => {
    await withErrorMessageStub(async (shown) => {
      const { stream, state } = fakeStream();
      const ops = fakeFsOps(stream);
      const { log, errors } = fakeLog();
      // No route for the real export's own first page: if `ensureDiskSpace`
      // failed to stop the export before it started, this would throw on an
      // unmatched request rather than let the assertions below pass by
      // accident.
      const adapter = libraryAdapter([OPEN_ROUTE, DISK_SPACE_SAMPLE_ROUTE]);

      await runCsvExport(tableItem(), adapter, {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: ops.createWriteStream,
        rename: ops.rename,
        unlink: ops.unlink,
        // One byte free — the sample alone already exceeds it.
        statfs: () => Promise.resolve({ bavail: 1, bsize: 1 }),
      });

      assert.deepEqual(state.chunks, []);
      assert.ok(state.ended);
      assert.deepEqual(ops.renamed, []);
      assert.deepEqual(ops.unlinked, ops.createdPaths);
      assert.equal(errors.length, 1);
      assert.equal(shown.length, 1);
      assert.match(shown[0] ?? "", /free/);
    });
  });

  it("reports and cleans up after writing what succeeded, when a later page fails", async () => {
    await withErrorMessageStub(async (shown) => {
      const { stream, state } = fakeStream();
      const ops = fakeFsOps(stream);
      const { log, errors } = fakeLog();
      const adapter = libraryAdapter([
        OPEN_ROUTE,
        DISK_SPACE_SAMPLE_ROUTE,
        {
          when: `${CLASS_HREF}/rows?start=0&limit=500&includeColumnNames=true`,
          reply: dataCsv("Name,Sex\nAlfred,M\n"),
        },
        {
          when: `${CLASS_HREF}/rows?start=500&limit=500`,
          reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
        },
      ]);

      await runCsvExport(tableItem(), adapter, {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: ops.createWriteStream,
        rename: ops.rename,
        unlink: ops.unlink,
        statfs: ampleDiskSpace(),
      });

      assert.deepEqual(state.chunks, ["Name,Sex\nAlfred,M\n"]);
      assert.deepEqual(ops.renamed, []);
      assert.deepEqual(ops.unlinked, ops.createdPaths);
      assert.equal(errors.length, 1);
      assert.equal(shown.length, 1);
    });
  });

  it("reports and cleans up when the underlying stream fails during its final flush, after every row already wrote cleanly", async () => {
    await withErrorMessageStub(async (shown) => {
      const { stream, state } = fakeStream({
        errorDuringEnd: new Error("ENOSPC: no space left on device"),
      });
      const ops = fakeFsOps(stream);
      const { log, errors } = fakeLog();
      const adapter = libraryAdapter([
        OPEN_ROUTE,
        DISK_SPACE_SAMPLE_ROUTE,
        {
          when: `${CLASS_HREF}/rows?start=0&limit=500&includeColumnNames=true`,
          reply: dataCsv("Name,Sex\nAlfred,M\n"),
        },
        {
          when: `${CLASS_HREF}/rows?start=500&limit=500`,
          reply: dataCsv(""),
        },
      ]);

      await runCsvExport(tableItem(), adapter, {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) =>
          run(new vscode.CancellationTokenSource().token),
        createWriteStream: ops.createWriteStream,
        rename: ops.rename,
        unlink: ops.unlink,
        statfs: ampleDiskSpace(),
      });

      // Every page fetched and written without incident — the failure only
      // surfaces once the stream's own final flush reports it.
      assert.deepEqual(state.chunks, ["Name,Sex\nAlfred,M\n"]);
      assert.ok(state.ended);
      assert.deepEqual(ops.renamed, []);
      assert.deepEqual(ops.unlinked, ops.createdPaths);
      assert.equal(errors.length, 1);
      assert.equal(shown.length, 1);
    });
  });

  it("says nothing, but still cleans up, when the user cancels", async () => {
    await withErrorMessageStub(async (shown) => {
      const { stream } = fakeStream();
      const ops = fakeFsOps(stream);
      const { log, errors } = fakeLog();
      const source = new vscode.CancellationTokenSource();
      // The same "cancel before `run` even sees the token" shape
      // `session-manager.test.ts` uses for its own "says nothing when the
      // user cancels" case — `abortOn` reads `isCancellationRequested`
      // synchronously and aborts before any request goes out. The route
      // below stands in for what a real transport reports for a request
      // that went out already aborted (`cancellation.ts`'s own doc
      // comment); the recorded fake client does not itself implement abort
      // semantics, so this is scripted rather than genuinely triggered.
      const adapter = libraryAdapter([
        {
          when: CLASS_HREF,
          reply: dataFail({
            code: "compute-unreachable",
            detail: "GET … — This operation was aborted",
          }),
        },
      ]);

      await runCsvExport(tableItem(), adapter, {
        log,
        showSaveDialog: () => Promise.resolve(SAVE_URI),
        withProgress: (_title, run) => {
          source.cancel();
          return run(source.token);
        },
        createWriteStream: ops.createWriteStream,
        rename: ops.rename,
        unlink: ops.unlink,
      });

      assert.deepEqual(errors, []);
      assert.deepEqual(shown, []);
      assert.deepEqual(ops.renamed, []);
      assert.deepEqual(ops.unlinked, ops.createdPaths);
    });
  });
});

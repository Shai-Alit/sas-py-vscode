// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `LibraryCsvSource` (`src/data/libraryCsvSource.ts`, split out in 11d) driven
 * directly — open / sample / stream and each failure branch — against a real
 * `LibraryAdapter` wired to recorded `DataAccessApi` fixtures. `runCsvExport`'s
 * own integration test (`csv-export-command.test.ts`) only reaches this class
 * through the command; this file pins its contract in isolation. An
 * integration test, not a unit one, because the class imports `vscode`.
 */

import assert from "node:assert/strict";

import {
  LibraryAdapter,
  type ConnectedSession,
  type LibrarySessionSource,
} from "../../../src/data/adapter";
import { LibraryCsvSource } from "../../../src/data/libraryCsvSource";
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
const CLASS_HREF = `/compute/sessions/${SESSION_ID}/data/SASHELP/CLASS`;
const PAGE_SIZE = "500";

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

function source(routes: readonly RecordedDataRoute[]): LibraryCsvSource {
  const { client } = recordedDataClient(routes);
  const session: ComputeSession = { id: SESSION_ID, state: "idle", links: [] };
  const sessions: LibrarySessionSource = {
    isBusy: () => false,
    current: (): ConnectedSession | undefined => ({ client, session }),
  };
  return new LibraryCsvSource(
    tableItem(),
    new LibraryAdapter(sessions, "profile-1"),
  );
}

const OPEN_ROUTE: RecordedDataRoute = {
  when: CLASS_HREF,
  reply: dataFixture("table-detail-class.json"),
};

describe("LibraryCsvSource", () => {
  it("names itself library.table and logs as SAS Libraries", () => {
    const csv = source([]);
    assert.equal(csv.name, "SASHELP.CLASS");
    assert.equal(csv.logPrefix, "SAS Libraries");
  });

  it("open reports the table's own rowCount (table-detail-class.json: 19)", async () => {
    const opened = await source([OPEN_ROUTE]).open();
    assert.ok(opened.ok);
    assert.equal(opened.value.rowCount, 19);
  });

  it("open surfaces a failed table read as a failure with both strings", async () => {
    const opened = await source([
      {
        when: CLASS_HREF,
        reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
      },
    ]).open();
    assert.ok(!opened.ok);
    assert.notEqual(opened.message, "");
    assert.notEqual(opened.logDetail, "");
  });

  it("sample returns the first window as the server's CSV, header included", async () => {
    const csv = source([
      OPEN_ROUTE,
      {
        when: `${CLASS_HREF}/rows?start=0&limit=3&includeColumnNames=true`,
        reply: dataCsv("Name,Sex\nAlfred,M\n"),
      },
    ]);
    assert.ok((await csv.open()).ok);
    const sampled = await csv.sample(3);
    assert.ok(sampled.ok);
    assert.equal(sampled.value, "Name,Sex\nAlfred,M\n");
  });

  it("stream relays every page untouched and stops at the empty one", async () => {
    const csv = source([
      OPEN_ROUTE,
      {
        when: `${CLASS_HREF}/rows?start=0&limit=${PAGE_SIZE}&includeColumnNames=true`,
        reply: dataCsv("Name,Sex\nAlfred,M\n"),
      },
      {
        when: `${CLASS_HREF}/rows?start=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
        reply: dataCsv(""),
      },
    ]);
    assert.ok((await csv.open()).ok);
    const chunks: string[] = [];
    const result = await csv.stream((chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    assert.ok(result.ok);
    assert.deepEqual(chunks, ["Name,Sex\nAlfred,M\n"]);
  });

  it("stream turns a mid-export page failure into a failure and keeps what was written", async () => {
    const csv = source([
      OPEN_ROUTE,
      {
        when: `${CLASS_HREF}/rows?start=0&limit=${PAGE_SIZE}&includeColumnNames=true`,
        reply: dataCsv("Name,Sex\nAlfred,M\n"),
      },
      {
        when: `${CLASS_HREF}/rows?start=${PAGE_SIZE}&limit=${PAGE_SIZE}`,
        reply: dataFail({ code: "compute-rejected", error: { status: 500 } }),
      },
    ]);
    assert.ok((await csv.open()).ok);
    const chunks: string[] = [];
    const result = await csv.stream((chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    assert.ok(!result.ok);
    assert.notEqual(result.message, "");
    assert.deepEqual(chunks, ["Name,Sex\nAlfred,M\n"]);
  });

  it("sample and stream before open fail with 'not open yet' and request nothing", async () => {
    const csv = source([]);
    const sampled = await csv.sample(1);
    assert.ok(!sampled.ok);
    assert.equal(sampled.logDetail, "the table is not open yet");
    const streamed = await csv.stream(() => Promise.resolve());
    assert.ok(!streamed.ok);
    assert.equal(streamed.logDetail, "the table is not open yet");
  });
});

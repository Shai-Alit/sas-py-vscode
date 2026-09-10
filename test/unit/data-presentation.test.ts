// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  CONTEXT_LIBRARY,
  CONTEXT_TABLE,
  nodePresentationOf,
} from "../../src/data/presentation";
import { type LibraryItem, type TableItem } from "../../src/data/types";

describe("data/presentation nodePresentationOf", () => {
  it("presents a library as an expandable database icon", () => {
    const library: LibraryItem = {
      kind: "library",
      name: "SASHELP",
      readOnly: true,
      links: [],
    };
    assert.deepEqual(nodePresentationOf(library), {
      label: "SASHELP",
      expandable: true,
      icon: "database",
      contextValue: CONTEXT_LIBRARY,
    });
  });

  it("presents a table as a non-expandable leaf", () => {
    const table: TableItem = {
      kind: "table",
      libref: "SASHELP",
      name: "CLASS",
      readOnly: true,
      links: [],
    };
    assert.deepEqual(nodePresentationOf(table), {
      label: "CLASS",
      expandable: false,
      icon: "symbol-array",
      contextValue: CONTEXT_TABLE,
    });
  });

  it("presents WORK the same way regardless of readOnly", () => {
    const work: LibraryItem = {
      kind: "library",
      name: "WORK",
      readOnly: false,
      links: [],
    };
    assert.equal(nodePresentationOf(work).icon, "database");
    assert.equal(nodePresentationOf(work).expandable, true);
  });
});

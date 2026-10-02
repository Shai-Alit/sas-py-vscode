// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { isValidServerName, serverMoveObjection } from "../../src/server/move";

/** Whether a SAS Server drop is a move, decided before anything is sent. */

function folder(path: string, readOnly = false) {
  return { path, isDirectory: true, readOnly };
}

describe("serverMoveObjection", () => {
  it("allows a move into a writable folder elsewhere", () => {
    assert.equal(
      serverMoveObjection({ path: "/tmp/a/x.py" }, folder("/tmp/b")),
      undefined,
    );
    assert.equal(
      serverMoveObjection({ path: "/tmp/a" }, folder("/tmp/b")),
      undefined,
    );
  });

  it("refuses a file as the target", () => {
    assert.equal(
      serverMoveObjection(
        { path: "/tmp/a.py" },
        { path: "/tmp/b.py", isDirectory: false, readOnly: false },
      ),
      "target-not-a-folder",
    );
  });

  it("refuses the folder the item is already in", () => {
    assert.equal(
      serverMoveObjection({ path: "/tmp/a/x.py" }, folder("/tmp/a")),
      "same-folder",
    );
    assert.equal(
      serverMoveObjection({ path: "/tmp" }, folder("/")),
      "same-folder",
    );
  });

  it("refuses a folder into itself or below itself, but not into a sibling sharing its prefix (Finding 13.31)", () => {
    assert.equal(
      serverMoveObjection({ path: "/tmp/a" }, folder("/tmp/a")),
      "into-itself",
    );
    assert.equal(
      serverMoveObjection({ path: "/tmp/a" }, folder("/tmp/a/sub")),
      "into-itself",
    );
    assert.equal(
      serverMoveObjection({ path: "/tmp/a" }, folder("/tmp/ab")),
      undefined,
    );
  });

  it("refuses a read-only folder (Finding 13.34)", () => {
    assert.equal(
      serverMoveObjection({ path: "/tmp/a.py" }, folder("/", true)),
      "target-read-only",
    );
  });
});

describe("isValidServerName", () => {
  it("accepts an ordinary name, with spaces, dots and non-ASCII", () => {
    for (const name of ["a.py", "a b é.py", ".hidden", "x;y~z#q.txt"]) {
      assert.equal(isValidServerName(name), true, name);
    }
  });

  it("refuses empty, dot names, a separator and NUL", () => {
    for (const name of ["", ".", "..", "a/b", "/", "a\0b"]) {
      assert.equal(isValidServerName(name), false, JSON.stringify(name));
    }
  });
});

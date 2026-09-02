// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { ProgramOrigin, Traceback } from "../../../src/backend/backend";
import { RunDiagnostics } from "../../../src/run/diagnostics";

/** `RunDiagnostics` imports `vscode` and is outside the coverage denominator
 * (`.c8rc.json`), so this integration suite against a real
 * `DiagnosticCollection` is the only thing holding its line — the same shape
 * `output-channel.test.ts` takes for `RunOutputChannel`. */

let collectionSeq = 0;
const created: vscode.DiagnosticCollection[] = [];

function build(): {
  diagnostics: RunDiagnostics;
  collection: vscode.DiagnosticCollection;
} {
  collectionSeq += 1;
  const collection = vscode.languages.createDiagnosticCollection(
    `test-run-diagnostics-${String(collectionSeq)}`,
  );
  created.push(collection);
  const diagnostics = new RunDiagnostics({
    createCollection: () => collection,
  });
  return { diagnostics, collection };
}

function origin(lineOffset = 0): ProgramOrigin {
  return { uri: vscode.Uri.file("/workspace/app.py"), lineOffset };
}

function frame(file: string, line: number, name = "<module>") {
  return { file, line, name };
}

describe("RunDiagnostics", () => {
  afterEach(() => {
    for (const collection of created.splice(0)) {
      // A test that disposes its own collection leaves this a second call —
      // `DiagnosticCollection.dispose()` is idempotent, but guard anyway.
      try {
        collection.dispose();
      } catch {
        /* already disposed by the test body */
      }
    }
  });

  it("publishes one Error at the innermost <string> frame, the rest of the <string> stack as related info", () => {
    const { diagnostics, collection } = build();
    const traceback: Traceback = {
      message: "ZeroDivisionError: division by zero",
      frames: [
        frame("<string>", 2, "<module>"),
        frame("<string>", 7, "divide"),
      ],
    };
    const target = origin(0);
    diagnostics.publish(
      target,
      traceback,
      "ZeroDivisionError: division by zero",
    );

    const entries = collection.get(target.uri) ?? [];
    assert.equal(entries.length, 1);
    const diagnostic = entries[0];
    assert.ok(diagnostic);
    assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostic.source, "Python on Viya");
    assert.equal(diagnostic.message, "ZeroDivisionError: division by zero");
    // innermost <string> frame: line 7 (one-based) + offset 0, less 1.
    assert.equal(diagnostic.range.start.line, 6);
    assert.equal(diagnostic.range.start.character, 0);
    assert.equal(diagnostic.range.isEmpty, true);

    const related = diagnostic.relatedInformation ?? [];
    assert.equal(related.length, 2, "both <string> frames, outermost first");
    const outer = related[0];
    const inner = related[1];
    assert.ok(outer);
    assert.ok(inner);
    assert.equal(outer.location.uri.toString(), target.uri.toString());
    assert.equal(outer.location.range.start.line, 1, "frame line 2 → 1");
    assert.equal(inner.location.range.start.line, 6);
  });

  it("adds the origin's lineOffset (Run Selection) and omits related info for a single frame", () => {
    const { diagnostics, collection } = build();
    const traceback: Traceback = {
      message: "ValueError: boom",
      frames: [frame("<string>", 3, "<module>")],
    };
    const target = origin(10);
    diagnostics.publish(target, traceback, "ValueError: boom");

    const diagnostic = (collection.get(target.uri) ?? [])[0];
    assert.ok(diagnostic);
    assert.equal(diagnostic.range.start.line, 12, "3 + 10, less 1");
    assert.equal(
      diagnostic.relatedInformation,
      undefined,
      "one frame — nothing to relate it to",
    );
  });

  it("skips a non-<string> frame in related info but still maps the primary past it", () => {
    const { diagnostics, collection } = build();
    const traceback: Traceback = {
      message: "KeyError: 'x'",
      frames: [
        frame("<string>", 4, "<module>"),
        frame("/usr/lib/python3/site-packages/pkg/core.py", 88, "lookup"),
        frame("<string>", 9, "handler"),
      ],
    };
    const target = origin(0);
    diagnostics.publish(target, traceback, "KeyError: 'x'");

    const diagnostic = (collection.get(target.uri) ?? [])[0];
    assert.ok(diagnostic);
    // primaryFrame skips the library frame and takes the innermost <string>.
    assert.equal(diagnostic.range.start.line, 8);
    const related = diagnostic.relatedInformation ?? [];
    assert.equal(related.length, 2, "the two <string> frames only");
  });

  it("publishes nothing when no frame maps into the file", () => {
    const { diagnostics, collection } = build();
    const traceback: Traceback = {
      message: "RuntimeError: harness-only",
      frames: [
        frame("<stdin>", 1, "<module>"),
        frame("/usr/lib/python3/x.py", 5, "f"),
      ],
    };
    const target = origin(0);
    diagnostics.publish(target, traceback, "RuntimeError: harness-only");
    assert.deepEqual([...(collection.get(target.uri) ?? [])], []);
  });

  it("clearFor removes a previously published entry, and is safe on a URI with none", () => {
    const { diagnostics, collection } = build();
    const target = origin(0);
    diagnostics.publish(
      target,
      { message: "ValueError: x", frames: [frame("<string>", 1, "<module>")] },
      "ValueError: x",
    );
    assert.equal((collection.get(target.uri) ?? []).length, 1);

    diagnostics.clearFor(target.uri);
    assert.deepEqual([...(collection.get(target.uri) ?? [])], []);

    diagnostics.clearFor(vscode.Uri.file("/workspace/never-published.py"));
  });

  it("dispose() removes what it published", () => {
    const { diagnostics, collection } = build();
    // A URI no other test in this file touches, so the aggregate read below
    // reflects only this collection.
    const target = vscode.Uri.file("/workspace/dispose-test.py");
    diagnostics.publish(
      { uri: target, lineOffset: 0 },
      { message: "ValueError: x", frames: [frame("<string>", 1, "<module>")] },
      "ValueError: x",
    );
    assert.equal((collection.get(target) ?? []).length, 1);

    diagnostics.dispose();
    // `languages.getDiagnostics` reads across every collection and stays
    // usable once one is disposed — `collection.get` itself throws
    // "object is disposed". A torn-down collection contributes nothing.
    assert.deepEqual([...vscode.languages.getDiagnostics(target)], []);
  });
});

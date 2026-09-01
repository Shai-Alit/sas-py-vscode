// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { Uri } from "vscode";

import {
  type ProgramOrigin,
  type Traceback,
  type TracebackFrame,
} from "../../src/backend/backend";
import {
  mapFrameToOrigin,
  primaryFrame,
  primaryPosition,
  STRING_FRAME_FILE,
  withModuleNotFoundGuidance,
} from "../../src/backend/tracebackDiagnostics";

/** A fake `ProgramOrigin` — `uri` is a structural stand-in rather than a real
 * `vscode.Uri`, the same convention `test/helpers/fake-backend.ts`'s
 * `fakeProgram` uses: the unit tier has no `vscode` module to construct one
 * from, and nothing under test here reads it — only `lineOffset` does. */
function origin(lineOffset: number): ProgramOrigin {
  return {
    uri: { scheme: "file", path: "/workspace/program.py" } as unknown as Uri,
    lineOffset,
  };
}

function frame(file: string, line: number, name = "<module>"): TracebackFrame {
  return { file, line, name };
}

describe("tracebackDiagnostics", () => {
  describe("mapFrameToOrigin", () => {
    it("maps a <string> frame's one-based line through a whole-file origin (lineOffset 0)", () => {
      assert.deepEqual(
        mapFrameToOrigin(frame(STRING_FRAME_FILE, 1), origin(0)),
        {
          line: 0,
          character: 0,
        },
      );
      assert.deepEqual(
        mapFrameToOrigin(frame(STRING_FRAME_FILE, 4), origin(0)),
        {
          line: 3,
          character: 0,
        },
      );
    });

    it("adds a Run Selection origin's lineOffset (ADR-0014's identity mapping)", () => {
      // Selection started at editor line 5 (zero-based) — `buildProgram`'s own
      // shape (`commands.ts`). The uploaded file's own line 2 is therefore
      // editor line 5 + (2 - 1) = 6.
      assert.deepEqual(
        mapFrameToOrigin(frame(STRING_FRAME_FILE, 2), origin(5)),
        {
          line: 6,
          character: 0,
        },
      );
    });

    it("returns undefined for any frame that is not <string>, including a user-generated <stdin> one", () => {
      assert.equal(mapFrameToOrigin(frame("<stdin>", 1), origin(0)), undefined);
      assert.equal(
        mapFrameToOrigin(frame("/some/other/file.py", 1), origin(0)),
        undefined,
      );
    });

    it("always reports character 0 — PROC PYTHON's traceback carries no column", () => {
      const mapped = mapFrameToOrigin(frame(STRING_FRAME_FILE, 10), origin(0));
      assert.equal(mapped?.character, 0);
    });
  });

  describe("primaryFrame", () => {
    it("picks the innermost (last) <string> frame, not the first", () => {
      const traceback: Traceback = {
        message: "RecursionError: maximum recursion depth exceeded",
        frames: [
          frame(STRING_FRAME_FILE, 4, "<module>"),
          frame(STRING_FRAME_FILE, 2, "boom"),
        ],
      };
      assert.deepEqual(
        primaryFrame(traceback),
        frame(STRING_FRAME_FILE, 2, "boom"),
      );
    });

    it("skips a trailing user-generated <stdin> frame and finds the <string> frame beneath it", () => {
      // The exact shape `procPython.ts`'s own traceback test pins: a
      // `<string>` frame followed by a `<stdin>` frame the user's own
      // `compile(src, "<stdin>", "exec")` produced — a real frame, not the
      // harness's, and not mappable (see this module's own doc comment).
      const traceback: Traceback = {
        message: "ValueError: boom-from-compiled-stdin",
        frames: [
          frame(STRING_FRAME_FILE, 3, "<module>"),
          frame("<stdin>", 1, "<module>"),
        ],
      };
      assert.deepEqual(
        primaryFrame(traceback),
        frame(STRING_FRAME_FILE, 3, "<module>"),
      );
    });

    it("returns undefined when the stack is empty", () => {
      const traceback: Traceback = {
        message: "RuntimeError: harness-only-failure",
        frames: [],
      };
      assert.equal(primaryFrame(traceback), undefined);
    });

    it("returns undefined when the stack has frames but none is a <string> frame", () => {
      // Exercises the loop body's non-matching branch on a non-empty stack —
      // e.g. an exception raised entirely inside a user-generated `<stdin>`
      // code object, with no uploaded-file frame anywhere in the chain.
      const traceback: Traceback = {
        message: "ValueError: all-from-compiled-stdin",
        frames: [frame("<stdin>", 2, "<module>"), frame("<stdin>", 1, "inner")],
      };
      assert.equal(primaryFrame(traceback), undefined);
    });
  });

  describe("primaryPosition", () => {
    it("combines primaryFrame and mapFrameToOrigin in one call", () => {
      const traceback: Traceback = {
        message: "ValueError: boom-at-line-2",
        frames: [frame(STRING_FRAME_FILE, 2, "<module>")],
      };
      assert.deepEqual(primaryPosition(traceback, origin(0)), {
        line: 1,
        character: 0,
      });
    });

    it("returns undefined when primaryFrame does", () => {
      const traceback: Traceback = { message: "boom", frames: [] };
      assert.equal(primaryPosition(traceback, origin(0)), undefined);
    });
  });

  describe("withModuleNotFoundGuidance", () => {
    it("appends the Show Environment pointer to a ModuleNotFoundError message", () => {
      assert.equal(
        withModuleNotFoundGuidance(
          "ModuleNotFoundError: No module named 'polars'",
        ),
        "ModuleNotFoundError: No module named 'polars' Run \"Python on Viya: " +
          'Show Environment" to see what is installed on this connection.',
      );
    });

    it("leaves any other exception message unchanged", () => {
      assert.equal(
        withModuleNotFoundGuidance("ValueError: boom-at-line-2"),
        "ValueError: boom-at-line-2",
      );
    });

    it("does not match the words 'module' or 'not found' appearing mid-message", () => {
      // `traceback.message` is `messageLines.join(" ")` — a multi-line
      // message collapses onto one line, so a match has to be anchored at
      // the start, not searched for anywhere in the text.
      assert.equal(
        withModuleNotFoundGuidance("ValueError: module not found in registry"),
        "ValueError: module not found in registry",
      );
    });

    it("requires the colon, not just the bare exception name as a prefix", () => {
      assert.equal(
        withModuleNotFoundGuidance("ModuleNotFoundErrorWrapper: boom"),
        "ModuleNotFoundErrorWrapper: boom",
      );
    });
  });
});

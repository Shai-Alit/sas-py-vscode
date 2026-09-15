// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { RichOutput } from "../../src/backend/backend";
import { toNotebookOutputPieces } from "../../src/notebook/notebookRender";

describe("notebook/notebookRender", () => {
  describe("toNotebookOutputPieces", () => {
    it("turns text/plain into a stdout piece", () => {
      const output: RichOutput = { mime: "text/plain", data: "hello\n" };
      assert.deepEqual(toNotebookOutputPieces(output), [
        { kind: "stdout", text: "hello\n" },
      ]);
    });

    it("turns text/html into a real html piece, unlike render.ts's placeholder", () => {
      const output: RichOutput = { mime: "text/html", data: "<table></table>" };
      assert.deepEqual(toNotebookOutputPieces(output), [
        { kind: "html", markup: "<table></table>" },
      ]);
    });

    it("turns image/png into a real image piece, unlike render.ts's placeholder", () => {
      const output: RichOutput = { mime: "image/png", data: "aGVsbG8=" };
      assert.deepEqual(toNotebookOutputPieces(output), [
        { kind: "image", base64: "aGVsbG8=" },
      ]);
    });

    it("renders nothing for a structured traceback", () => {
      // Already visible as raw text/plain log lines by the time this run's
      // outputs reach a caller, and a raised cell already gets VS Code's own
      // red-X indicator — see this module's own doc comment.
      const output: RichOutput = {
        mime: "application/vnd.python.traceback",
        data: { message: "ZeroDivisionError: division by zero", frames: [] },
      };
      assert.deepEqual(toNotebookOutputPieces(output), []);
    });
  });
});

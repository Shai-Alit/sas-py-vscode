// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { RichOutput } from "../../src/backend/backend";
import { DATAFRAME_GRID_MIME } from "../../src/backend/dataFrameGrid";
import { renderRichOutput } from "../../src/run/render";

describe("run/render", () => {
  describe("renderRichOutput", () => {
    it("passes text/plain through as one raw line", () => {
      const output: RichOutput = { mime: "text/plain", data: "hello\n" };
      assert.deepEqual(renderRichOutput(output), [
        { kind: "raw", text: "hello\n" },
      ]);
    });

    it("defers text/html to a placeholder the shell localises", () => {
      const output: RichOutput = { mime: "text/html", data: "<table></table>" };
      assert.deepEqual(renderRichOutput(output), [
        { kind: "deferred-rich-output", mime: "text/html" },
      ]);
    });

    it("defers a DataFrame grid as the HTML table it also is (ADR-0048)", () => {
      const output: RichOutput = {
        mime: DATAFRAME_GRID_MIME,
        data: {
          rows: 1,
          columns: 1,
          fields: [{ name: "a", kind: "number", index: false }],
          data: [[1]],
          html: "<table><tr><td>1</td></tr></table>",
        },
      };
      assert.deepEqual(renderRichOutput(output), [
        { kind: "deferred-rich-output", mime: "text/html" },
      ]);
    });

    it("defers image/png to a placeholder the shell localises", () => {
      const output: RichOutput = { mime: "image/png", data: "aGVsbG8=" };
      assert.deepEqual(renderRichOutput(output), [
        { kind: "deferred-rich-output", mime: "image/png" },
      ]);
    });

    it("renders nothing for a structured traceback", () => {
      // Already visible as raw text/plain log lines by the time this run's
      // outputs reach a caller (logFilter.ts's isNoiseLine excludes only
      // "note" and "source") — see this module's own doc comment.
      const output: RichOutput = {
        mime: "application/vnd.python.traceback",
        data: { message: "ZeroDivisionError: division by zero", frames: [] },
      };
      assert.deepEqual(renderRichOutput(output), []);
    });
  });
});

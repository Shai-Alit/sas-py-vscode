// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { RichOutput } from "../../src/backend/backend";
import { toNotebookOutputPieces } from "../../src/notebook/notebookRender";

const labels = { svgDropped: "[svg dropped]" };

describe("notebook/notebookRender", () => {
  describe("toNotebookOutputPieces", () => {
    it("turns text/plain into a stdout piece", () => {
      const output: RichOutput = { mime: "text/plain", data: "hello\n" };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
        { kind: "stdout", text: "hello\n" },
      ]);
    });

    it("turns text/html into a real html piece, unlike render.ts's placeholder", () => {
      const output: RichOutput = { mime: "text/html", data: "<table></table>" };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
        { kind: "html", markup: "<table></table>" },
      ]);
    });

    it("replaces an ODS body's dropped SVG figure with the svgDropped label (Finding 12.18)", () => {
      const output: RichOutput = {
        mime: "text/html",
        data:
          '<div id="IDX"><span class="c systemtitle2">Output</span></div>' +
          "<div><svg><g>x</g></svg></div>",
      };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
        {
          kind: "html",
          markup:
            '<div id="IDX"><span class="c systemtitle2">Output</span></div>' +
            "<div><p>[svg dropped]</p></div>",
        },
      ]);
    });

    it("drops an SVG in HTML with no ODS anchor without the note, whose advice is for SAS.show", () => {
      const output: RichOutput = {
        mime: "text/html",
        data: "<p>icon</p><svg><path/></svg><p>end</p>",
      };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
        { kind: "html", markup: "<p>icon</p><p>end</p>" },
      ]);
    });

    it("drops every <style> of an ODS body, which would restyle other cells (Finding 12.18)", () => {
      // Two blocks, as in Finding 12.18's captured body.
      const output: RichOutput = {
        mime: "text/html",
        data:
          "<style>.output{color:#000}</style>" +
          "<style>.note{color:#112277}</style>" +
          '<div id="IDX">t</div>',
      };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
        { kind: "html", markup: '<div id="IDX">t</div>' },
      ]);
    });

    it("keeps the <style> of HTML with no ODS anchor, such as a pandas Styler", () => {
      const output: RichOutput = {
        mime: "text/html",
        data: "<style>#T_1 td{color:red}</style><table></table>",
      };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
        {
          kind: "html",
          markup: "<style>#T_1 td{color:red}</style><table></table>",
        },
      ]);
    });

    it("turns image/png into a real image piece, unlike render.ts's placeholder", () => {
      const output: RichOutput = { mime: "image/png", data: "aGVsbG8=" };
      assert.deepEqual(toNotebookOutputPieces(output, labels), [
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
      assert.deepEqual(toNotebookOutputPieces(output, labels), []);
    });
  });
});

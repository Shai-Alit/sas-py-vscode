// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import type { RichOutput } from "../../src/backend/backend";
import {
  isAlreadyVisibleAsText,
  isRenderItem,
  isResultPanelMessage,
  isRevealFrameMessage,
  outcomeMessage,
  toRenderItem,
  type RenderItemLabels,
} from "../../src/run/resultPanelModel";

const labels: RenderItemLabels = {
  imageAlt: (index) => `Output image ${String(index)}`,
  tracebackHeading: () => "Traceback",
  tracebackFrame: (frame) =>
    `${frame.file}, line ${String(frame.line)}, in ${frame.name}`,
};

describe("run/resultPanelModel", () => {
  describe("toRenderItem", () => {
    it("passes text/plain through as text", () => {
      const output: RichOutput = { mime: "text/plain", data: "hello\n" };
      assert.deepEqual(toRenderItem(output, labels, 1), {
        kind: "text",
        text: "hello\n",
      });
    });

    it("passes text/html through as markup, not escaped text", () => {
      const output: RichOutput = {
        mime: "text/html",
        data: "<table><tr><td>1</td></tr></table>",
      };
      assert.deepEqual(toRenderItem(output, labels, 1), {
        kind: "html",
        markup: "<table><tr><td>1</td></tr></table>",
      });
    });

    it("wraps image/png as a data URI with the caller's alt text, numbered by image index", () => {
      const output: RichOutput = { mime: "image/png", data: "aGVsbG8=" };
      assert.deepEqual(toRenderItem(output, labels, 3), {
        kind: "image",
        dataUri: "data:image/png;base64,aGVsbG8=",
        alt: "Output image 3",
      });
    });

    it("structures a traceback with the caller's heading and every frame, formatted in order", () => {
      const output: RichOutput = {
        mime: "application/vnd.python.traceback",
        data: {
          message: "ZeroDivisionError: division by zero",
          frames: [
            { file: "app.py", line: 3, name: "<module>" },
            { file: "app.py", line: 7, name: "divide" },
          ],
        },
      };
      assert.deepEqual(toRenderItem(output, labels, 1), {
        kind: "traceback",
        heading: "Traceback",
        message: "ZeroDivisionError: division by zero",
        frameLines: [
          "app.py, line 3, in <module>",
          "app.py, line 7, in divide",
        ],
        // Phase 4d: the same frames, raw, in the same order — the DOM layer
        // keys on `file` for clickability and the host maps by index.
        frames: [
          { file: "app.py", line: 3, name: "<module>" },
          { file: "app.py", line: 7, name: "divide" },
        ],
      });
    });

    it("only calls tracebackHeading()/tracebackFrame() when the output is actually a traceback", () => {
      let headingCalls = 0;
      let frameCalls = 0;
      const countingLabels: RenderItemLabels = {
        imageAlt: (index) => `Output image ${String(index)}`,
        tracebackHeading: () => {
          headingCalls += 1;
          return "Traceback";
        },
        tracebackFrame: (frame) => {
          frameCalls += 1;
          return frame.name;
        },
      };
      toRenderItem({ mime: "text/plain", data: "hi" }, countingLabels, 1);
      toRenderItem({ mime: "image/png", data: "AA==" }, countingLabels, 1);
      toRenderItem(
        { mime: "text/html", data: "<table></table>" },
        countingLabels,
        1,
      );
      assert.equal(headingCalls, 0);
      assert.equal(frameCalls, 0);
    });

    it("invents no text of its own — every string on the result comes from RichOutput or labels", () => {
      // Guards the module's own doc comment: nothing here may hardcode an
      // English word, because the localisation boundary lives in the caller.
      const output: RichOutput = { mime: "image/png", data: "AA==" };
      const item = toRenderItem(output, labels, 1);
      assert.equal(item.kind, "image");
      assert.equal(item.alt, labels.imageAlt(1));
    });
  });

  describe("isAlreadyVisibleAsText", () => {
    it("is true only for text/plain", () => {
      assert.equal(
        isAlreadyVisibleAsText({ mime: "text/plain", data: "x" }),
        true,
      );
    });

    it("is false for text/html, image/png and a traceback", () => {
      assert.equal(
        isAlreadyVisibleAsText({ mime: "text/html", data: "<p></p>" }),
        false,
      );
      assert.equal(
        isAlreadyVisibleAsText({ mime: "image/png", data: "AA==" }),
        false,
      );
      assert.equal(
        isAlreadyVisibleAsText({
          mime: "application/vnd.python.traceback",
          data: { message: "boom", frames: [] },
        }),
        false,
      );
    });
  });

  describe("isRenderItem", () => {
    it("accepts one well-formed value of each kind", () => {
      assert.equal(isRenderItem({ kind: "text", text: "hi" }), true);
      assert.equal(
        isRenderItem({ kind: "image", dataUri: "data:...", alt: "Image 1" }),
        true,
      );
      assert.equal(isRenderItem({ kind: "html", markup: "<p></p>" }), true);
      assert.equal(
        isRenderItem({
          kind: "traceback",
          heading: "Traceback",
          message: "boom",
          frameLines: ["a.py, line 1, in <module>"],
          frames: [{ file: "<string>", line: 1, name: "<module>" }],
        }),
        true,
      );
    });

    it("rejects a value with the right kind but a missing field", () => {
      assert.equal(isRenderItem({ kind: "text" }), false);
      assert.equal(isRenderItem({ kind: "image", dataUri: "x" }), false);
      assert.equal(
        isRenderItem({ kind: "traceback", heading: "h", message: "m" }),
        false,
      );
    });

    it("rejects an unrecognised kind, a non-object, and a non-string frame line", () => {
      assert.equal(isRenderItem({ kind: "unknown" }), false);
      assert.equal(isRenderItem("text"), false);
      assert.equal(isRenderItem(null), false);
      assert.equal(
        isRenderItem({
          kind: "traceback",
          heading: "h",
          message: "m",
          frameLines: ["ok", 2],
          frames: [{ file: "<string>", line: 1, name: "<module>" }],
        }),
        false,
      );
    });

    it("rejects a traceback whose structured frames are missing or malformed", () => {
      const base = {
        kind: "traceback",
        heading: "h",
        message: "m",
        frameLines: ["a.py, line 1, in <module>"],
      };
      assert.equal(isRenderItem(base), false, "frames absent");
      assert.equal(isRenderItem({ ...base, frames: "nope" }), false);
      assert.equal(isRenderItem({ ...base, frames: [null] }), false);
      assert.equal(
        isRenderItem({ ...base, frames: [{ line: 1, name: "<module>" }] }),
        false,
        "frame missing file",
      );
      assert.equal(
        isRenderItem({ ...base, frames: [{ file: "<string>", line: 1 }] }),
        false,
        "frame missing name",
      );
      assert.equal(
        isRenderItem({
          ...base,
          frames: [{ file: "<string>", line: "1", name: "<module>" }],
        }),
        false,
        "frame line not a number",
      );
    });
  });

  describe("isResultPanelMessage", () => {
    it("accepts one well-formed message of each type", () => {
      assert.equal(isResultPanelMessage({ type: "reset" }), true);
      assert.equal(
        isResultPanelMessage({
          type: "output",
          item: { kind: "text", text: "hi" },
        }),
        true,
      );
      assert.equal(
        isResultPanelMessage({
          type: "outcome",
          summary: "Finished.",
          succeeded: true,
          diagnostics: [],
        }),
        true,
      );
      assert.equal(
        isResultPanelMessage({ type: "failure", message: "no profile" }),
        true,
      );
    });

    it("rejects an output message whose item does not validate", () => {
      assert.equal(
        isResultPanelMessage({ type: "output", item: { kind: "text" } }),
        false,
      );
    });

    it("rejects an outcome message with a non-string diagnostic", () => {
      assert.equal(
        isResultPanelMessage({
          type: "outcome",
          summary: "Finished.",
          succeeded: true,
          diagnostics: [1],
        }),
        false,
      );
    });

    it("rejects an unrecognised type, and anything that is not an object", () => {
      assert.equal(isResultPanelMessage({ type: "unknown" }), false);
      assert.equal(isResultPanelMessage(undefined), false);
      assert.equal(isResultPanelMessage(42), false);
    });
  });

  describe("isRevealFrameMessage", () => {
    it("accepts a well-formed revealFrame message", () => {
      assert.equal(
        isRevealFrameMessage({ type: "revealFrame", frameIndex: 0 }),
        true,
      );
      assert.equal(
        isRevealFrameMessage({ type: "revealFrame", frameIndex: 3 }),
        true,
      );
    });

    it("rejects a wrong type, a missing/negative/non-integer index, and a non-object", () => {
      assert.equal(isRevealFrameMessage({ type: "ready" }), false);
      assert.equal(isRevealFrameMessage({ type: "revealFrame" }), false);
      assert.equal(
        isRevealFrameMessage({ type: "revealFrame", frameIndex: -1 }),
        false,
      );
      assert.equal(
        isRevealFrameMessage({ type: "revealFrame", frameIndex: 1.5 }),
        false,
      );
      assert.equal(
        isRevealFrameMessage({ type: "revealFrame", frameIndex: "0" }),
        false,
      );
      assert.equal(isRevealFrameMessage(null), false);
      assert.equal(isRevealFrameMessage("revealFrame"), false);
    });
  });

  describe("outcomeMessage", () => {
    it("carries the caller's summary and success through, with no diagnostics", () => {
      assert.deepEqual(
        outcomeMessage({ succeeded: true, diagnostics: [] }, "Finished."),
        {
          type: "outcome",
          summary: "Finished.",
          succeeded: true,
          diagnostics: [],
        },
      );
    });

    it("flattens every diagnostic to its plain message string", () => {
      assert.deepEqual(
        outcomeMessage(
          {
            succeeded: false,
            diagnostics: [
              { severity: "error", message: "ZeroDivisionError" },
              { severity: "warning", message: "deprecated" },
            ],
          },
          "Finished with an error.",
        ),
        {
          type: "outcome",
          summary: "Finished with an error.",
          succeeded: false,
          diagnostics: ["ZeroDivisionError", "deprecated"],
        },
      );
    });
  });
});

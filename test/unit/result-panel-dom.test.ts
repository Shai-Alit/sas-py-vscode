// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { applyMessage, type DomPort } from "../../src/run/resultPanelDom";
import type { ResultPanelMessage } from "../../src/run/resultPanelModel";

/** A plain, inspectable stand-in for a real DOM node — everything a test
 * needs to assert on, nothing a real `HTMLElement` carries that this module
 * never asked for. */
interface FakeElement {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  text: string | undefined;
  markup: string | undefined;
  readonly children: FakeElement[];
}

function fakeRoot(): FakeElement {
  return {
    tag: "root",
    attrs: {},
    text: undefined,
    markup: undefined,
    children: [],
  };
}

function fakePort(): DomPort<FakeElement> {
  return {
    createElement: (tag) => ({
      tag,
      attrs: {},
      text: undefined,
      markup: undefined,
      children: [],
    }),
    setAttribute: (element, name, value) => {
      element.attrs[name] = value;
    },
    setText: (element, text) => {
      element.text = text;
    },
    setMarkup: (element, html) => {
      element.markup = html;
    },
    appendChild: (parent, child) => {
      parent.children.push(child);
    },
    clear: (element) => {
      element.children.length = 0;
    },
  };
}

describe("run/resultPanelDom", () => {
  describe("applyMessage", () => {
    it("reset clears every existing child, and nothing else", () => {
      const root = fakeRoot();
      root.children.push({
        tag: "pre",
        attrs: {},
        text: "leftover",
        markup: undefined,
        children: [],
      });
      applyMessage(fakePort(), root, { type: "reset" });
      assert.deepEqual(root.children, []);
    });

    it("a text output appends a <pre> carrying the text verbatim", () => {
      const root = fakeRoot();
      const message: ResultPanelMessage = {
        type: "output",
        item: { kind: "text", text: "hello\n" },
      };
      applyMessage(fakePort(), root, message);
      assert.equal(root.children.length, 1);
      // `noUncheckedIndexedAccess` widens `root.children[0]` to
      // `FakeElement | undefined`; `assert.ok` (an `asserts value` signature
      // in @types/node) narrows it back to `FakeElement` once, here, rather
      // than repeating `?.` on every property read below. That repetition is
      // what tripped `@typescript-eslint/no-unnecessary-condition` before —
      // confirmed empirically, not by guessing again: the rule's verdict on
      // `x?.y` does not depend only on whether `x` can be nullish, but also
      // on whether `y`'s own declared type already includes `undefined`
      // (`text`/`markup` here do; `tag` does not), so it flags some chains
      // off the very same variable and not others. A narrowing assertion
      // sidesteps that inconsistency entirely — there is no `?.` left for it
      // to judge. It also makes the test fail loudly if `applyMessage` ever
      // stopped appending a child at all, instead of silently comparing
      // `undefined` against an expected value and passing vacuously.
      const child = root.children[0];
      assert.ok(child);
      assert.equal(child.tag, "pre");
      assert.equal(child.text, "hello\n");
    });

    it("an image output appends an <img> with src and alt set, never text or markup", () => {
      const root = fakeRoot();
      const message: ResultPanelMessage = {
        type: "output",
        item: {
          kind: "image",
          dataUri: "data:image/png;base64,aGVsbG8=",
          alt: "Output image 1",
        },
      };
      applyMessage(fakePort(), root, message);
      const child = root.children[0];
      assert.ok(child);
      assert.equal(child.tag, "img");
      assert.equal(child.attrs.src, "data:image/png;base64,aGVsbG8=");
      assert.equal(child.attrs.alt, "Output image 1");
      assert.equal(child.text, undefined);
      assert.equal(child.markup, undefined);
    });

    it("an html output is inserted as markup, not escaped as text", () => {
      const root = fakeRoot();
      const message: ResultPanelMessage = {
        type: "output",
        item: { kind: "html", markup: "<table><tr><td>1</td></tr></table>" },
      };
      applyMessage(fakePort(), root, message);
      const child = root.children[0];
      assert.ok(child);
      assert.equal(child.markup, "<table><tr><td>1</td></tr></table>");
      assert.equal(child.text, undefined);
    });

    it("a traceback becomes a heading, a message, and one list entry per frame", () => {
      const root = fakeRoot();
      const message: ResultPanelMessage = {
        type: "output",
        item: {
          kind: "traceback",
          heading: "Traceback",
          message: "ZeroDivisionError: division by zero",
          frameLines: [
            "app.py, line 3, in <module>",
            "app.py, line 7, in divide",
          ],
        },
      };
      applyMessage(fakePort(), root, message);
      const container = root.children[0];
      assert.ok(container);
      assert.equal(container.tag, "div");
      const heading = container.children[0];
      const messageEl = container.children[1];
      const list = container.children[2];
      assert.ok(heading);
      assert.ok(messageEl);
      assert.ok(list);
      assert.equal(heading.tag, "h3");
      assert.equal(heading.text, "Traceback");
      assert.equal(messageEl.tag, "p");
      assert.equal(messageEl.text, "ZeroDivisionError: division by zero");
      assert.equal(list.tag, "ol");
      assert.equal(list.children.length, 2);
      const frame0 = list.children[0];
      const frame1 = list.children[1];
      assert.ok(frame0);
      assert.ok(frame1);
      assert.equal(frame0.text, "app.py, line 3, in <module>");
      assert.equal(frame1.text, "app.py, line 7, in divide");
    });

    it("a traceback with no frames omits the list entirely", () => {
      const root = fakeRoot();
      const message: ResultPanelMessage = {
        type: "output",
        item: {
          kind: "traceback",
          heading: "Traceback",
          message: "boom",
          frameLines: [],
        },
      };
      applyMessage(fakePort(), root, message);
      const container = root.children[0];
      assert.ok(container);
      assert.equal(container.children.length, 2, "heading and message only");
    });

    it("a successful outcome carries its summary and no diagnostics list", () => {
      const root = fakeRoot();
      applyMessage(fakePort(), root, {
        type: "outcome",
        summary: "Finished.",
        succeeded: true,
        diagnostics: [],
      });
      const container = root.children[0];
      assert.ok(container);
      assert.match(container.attrs.class ?? "", /outcome-success/);
      const summaryEl = container.children[0];
      assert.ok(summaryEl);
      assert.equal(summaryEl.text, "Finished.");
      assert.equal(container.children.length, 1);
    });

    it("a failed outcome lists every diagnostic", () => {
      const root = fakeRoot();
      applyMessage(fakePort(), root, {
        type: "outcome",
        summary: "Finished with an error.",
        succeeded: false,
        diagnostics: ["ZeroDivisionError"],
      });
      const container = root.children[0];
      assert.ok(container);
      assert.match(container.attrs.class ?? "", /outcome-failure/);
      const list = container.children[1];
      assert.ok(list);
      assert.equal(list.tag, "ul");
      const diagnostic = list.children[0];
      assert.ok(diagnostic);
      assert.equal(diagnostic.text, "ZeroDivisionError");
    });

    it("a failure appends one localised paragraph", () => {
      const root = fakeRoot();
      applyMessage(fakePort(), root, {
        type: "failure",
        message: "No SAS Viya connection profile is selected.",
      });
      const child = root.children[0];
      assert.ok(child);
      assert.equal(child.tag, "p");
      assert.equal(child.text, "No SAS Viya connection profile is selected.");
    });

    it("applies several messages in sequence without disturbing earlier ones", () => {
      const root = fakeRoot();
      const port = fakePort();
      applyMessage(port, root, { type: "reset" });
      applyMessage(port, root, {
        type: "output",
        item: { kind: "text", text: "one\n" },
      });
      applyMessage(port, root, {
        type: "output",
        item: { kind: "text", text: "two\n" },
      });
      assert.equal(root.children.length, 2);
      const first = root.children[0];
      const second = root.children[1];
      assert.ok(first);
      assert.ok(second);
      assert.equal(first.text, "one\n");
      assert.equal(second.text, "two\n");
    });
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { loadScript } from "../helpers/load-script";

interface Block {
  language: string;
  flags: string[];
  startLine: number;
  content: string;
}

// Property signatures, not methods: these are plain functions read off a module
// namespace, and declaring them as methods invites `unbound-method` to warn
// about a `this` that was never there.
interface CheckDocsSamples {
  extractBlocks: (markdown: string) => Block[];
  hasFlag: (block: Block, keyword: string) => boolean;
}

/**
 * The fenced-block extractor behind `npm run docs:samples`.
 *
 * Tested at this level of detail because of how the first version failed. It
 * accumulated only fence lines, so every sample it produced was an empty file
 * and every empty file type-checked. The run said "2 sample(s) type-check" and
 * meant "I checked two blank files" — a green result that is indistinguishable
 * from a real one, on a tool whose entire job is to notice things.
 *
 * That is why these assertions are about *content* rather than about counts.
 */
describe("docs sample extraction", () => {
  let extractBlocks: CheckDocsSamples["extractBlocks"];
  let hasFlag: CheckDocsSamples["hasFlag"];

  before(async () => {
    ({ extractBlocks, hasFlag } = await loadScript<CheckDocsSamples>(
      "check-docs-samples.mjs",
    ));
  });

  // Built by joining rather than written as a template literal, because a
  // markdown fence inside a template literal in a file that is itself a code
  // sample is a good way to confuse every tool in the chain.
  const fence = "```";

  it("captures the body of a block, blank lines included", () => {
    const [block] = extractBlocks(
      ["intro", `${fence}ts`, "const a = 1;", "", "const b = 2;", fence].join(
        "\n",
      ),
    );

    assert.ok(block);
    assert.equal(
      block.content,
      "const a = 1;\n\nconst b = 2;",
      "the blank line was dropped, or the body was never collected at all.",
    );
    assert.equal(block.language, "ts");
  });

  it("reports the line the content starts on, not the fence", () => {
    // The whole diagnostic-remapping story rests on this number. Off by one
    // here and every error the checker reports points at the wrong line, which
    // is worse than reporting no line.
    const [block] = extractBlocks(
      ["# Title", "", "prose", `${fence}ts`, "const a = 1;", fence].join("\n"),
    );
    assert.equal(block?.startLine, 5);
  });

  it("keeps flag case, and folds it only when matching a keyword", () => {
    const [block] = extractBlocks(
      [
        `${fence}ts path=test/unit/Mixed-Case.test.ts NO-CHECK`,
        "x",
        fence,
      ].join("\n"),
    );

    assert.ok(block);
    assert.deepEqual(block.flags, [
      "path=test/unit/Mixed-Case.test.ts",
      "NO-CHECK",
    ]);
    assert.equal(
      hasFlag(block, "no-check"),
      true,
      "keyword matching should not care about case.",
    );
    // Lowercasing the whole flag would rewrite the declared directory into one
    // that does not exist on Linux, and the error would name a path nobody typed.
    assert.ok(block.flags.some((flag) => flag.includes("Mixed-Case")));
  });

  it("does not treat an unflagged block as flagged", () => {
    const [block] = extractBlocks([`${fence}ts`, "x", fence].join("\n"));
    assert.ok(block);
    assert.deepEqual(block.flags, []);
    assert.equal(hasFlag(block, "no-check"), false);
  });

  it("returns every fenced block, so the caller decides what is checkable", () => {
    const blocks = extractBlocks(
      [
        `${fence}ts`,
        "a",
        fence,
        "",
        `${fence}bash`,
        "npm ci",
        fence,
        "",
        fence,
        "no language",
        fence,
      ].join("\n"),
    );
    assert.deepEqual(
      blocks.map((b) => b.language),
      ["ts", "bash", ""],
    );
  });

  it("lets a longer fence contain a shorter one", () => {
    // Not hypothetical: the documentation for this script shows a fenced block
    // inside a fenced block, and a naive "any ``` closes it" reader truncates
    // that sample in the middle.
    const [block] = extractBlocks(
      ["````md", `${fence}ts`, "const a = 1;", fence, "````"].join("\n"),
    );
    assert.ok(block);
    assert.equal(
      block.content,
      [`${fence}ts`, "const a = 1;", fence].join("\n"),
    );
  });

  it("does not close a block on a fence that carries an info string", () => {
    const blocks = extractBlocks(
      [`${fence}ts`, "const a = 1;", `${fence}ts`, "const b = 2;", fence].join(
        "\n",
      ),
    );
    assert.equal(blocks.length, 1);
    assert.match(blocks[0]?.content ?? "", /const b = 2;/);
  });

  it("refuses an unterminated fence instead of guessing", () => {
    assert.throws(
      () => extractBlocks(["prose", `${fence}ts`, "const a = 1;"].join("\n")),
      /unterminated .* fence opened on line 2/,
      "an unterminated fence turns the rest of the page into a code block; it is a markdown bug worth naming.",
    );
  });
});

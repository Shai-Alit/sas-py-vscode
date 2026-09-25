// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  decodeHtml,
  decodeRichOutput,
  exceedsCaptureCap,
  hasOdsOutput,
  MAX_CAPTURE_BYTES,
  ODS_BODY_FILE_NAME,
  richOutputMimeForName,
  selectOdsBody,
  selectRichOutputCandidates,
  skippedCaptureOutput,
  skippedOdsOutput,
} from "../../src/backend/richOutput";

import { type SessionFile } from "../../src/compute/files";
import { readFixtureBytes } from "../helpers/fixtures";

/**
 * The pure diff/filter/order/cap/decode logic ADR-0019 describes — no
 * `ComputeClient`, no session, just directory listings and bytes.
 */

function sessionFile(name: string, size: number | undefined): SessionFile {
  return { name, size, links: [] };
}

describe("richOutputMimeForName", () => {
  it("recognises .png", () => {
    assert.equal(richOutputMimeForName("plot.png"), "image/png");
  });

  it("is case-insensitive", () => {
    assert.equal(richOutputMimeForName("PLOT.PNG"), "image/png");
    assert.equal(richOutputMimeForName("table.HTML"), "text/html");
  });

  it("recognises .html and .htm", () => {
    assert.equal(richOutputMimeForName("table.html"), "text/html");
    assert.equal(richOutputMimeForName("table.htm"), "text/html");
  });

  it("recognises neither .jpg, .svg, .csv, nor an extensionless name", () => {
    // The whitelist is closed on purpose — see this module's own doc
    // comment on why widening it is not this slice's decision.
    assert.equal(richOutputMimeForName("plot.jpg"), undefined);
    assert.equal(richOutputMimeForName("plot.svg"), undefined);
    assert.equal(richOutputMimeForName("table.csv"), undefined);
    assert.equal(richOutputMimeForName("noextension"), undefined);
  });
});

describe("selectRichOutputCandidates", () => {
  it("captures a new whitelisted file with the shape finding 61 observed", () => {
    // Finding 61: nothing existed before the run; `fig.savefig(...)` produced
    // a single new 23,206-byte PNG in the session's working directory.
    const before: readonly SessionFile[] = [];
    const after: readonly SessionFile[] = [
      sessionFile("probe_plot.png", 23_206),
    ];

    const candidates = selectRichOutputCandidates(before, after);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.file.name, "probe_plot.png");
    // `candidates[0]` is narrowed non-nullish by the assertion above (TS
    // narrows through the optional chain once the accessed property is
    // asserted equal to a string literal), so this one drops the `?.` —
    // keeping it trips `no-unnecessary-condition`.
    assert.equal(candidates[0].mime, "image/png");
  });

  it("does not capture a file unchanged in both name and size", () => {
    const before: readonly SessionFile[] = [sessionFile("plot.png", 100)];
    const after: readonly SessionFile[] = [sessionFile("plot.png", 100)];

    assert.deepEqual(selectRichOutputCandidates(before, after), []);
  });

  it("captures a file that changed size, even though it existed before", () => {
    // ADR-0019 point 4: a same-name, different-size file is still a
    // candidate. A same-name, same-size rewrite is the one thing this
    // design accepts as invisible (recorded in ADR-0019's Consequences).
    const before: readonly SessionFile[] = [sessionFile("plot.png", 100)];
    const after: readonly SessionFile[] = [sessionFile("plot.png", 200)];

    const candidates = selectRichOutputCandidates(before, after);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.file.size, 200);
  });

  it("does not capture a new file outside the whitelist", () => {
    const before: readonly SessionFile[] = [];
    const after: readonly SessionFile[] = [sessionFile("notes.txt", 10)];

    assert.deepEqual(selectRichOutputCandidates(before, after), []);
  });

  it("does not capture a file that disappeared", () => {
    const before: readonly SessionFile[] = [sessionFile("plot.png", 100)];
    const after: readonly SessionFile[] = [];

    assert.deepEqual(selectRichOutputCandidates(before, after), []);
  });

  it("orders multiple candidates by filename, ascending, ordinally", () => {
    // Capital letters sort before lowercase under a plain ordinal comparison
    // (ASCII `A` < `a`) but not necessarily under every locale's collation —
    // this proves the ordinal choice, not merely "sorted somehow".
    const before: readonly SessionFile[] = [];
    const after: readonly SessionFile[] = [
      sessionFile("b_plot.png", 10),
      sessionFile("A_plot.png", 10),
      sessionFile("a_table.html", 10),
    ];

    const candidates = selectRichOutputCandidates(before, after);

    assert.deepEqual(
      candidates.map((candidate) => candidate.file.name),
      ["A_plot.png", "a_table.html", "b_plot.png"],
    );
  });

  it("mixes new and changed candidates across both mime types", () => {
    const before: readonly SessionFile[] = [sessionFile("existing.html", 50)];
    const after: readonly SessionFile[] = [
      sessionFile("existing.html", 75),
      sessionFile("fresh.png", 23_206),
    ];

    const candidates = selectRichOutputCandidates(before, after);

    assert.deepEqual(
      candidates.map((candidate) => [candidate.file.name, candidate.mime]),
      [
        ["existing.html", "text/html"],
        ["fresh.png", "image/png"],
      ],
    );
  });
});

describe("the ODS body file (ADR-0038)", () => {
  it("is never an ordinary candidate, even though .htm is whitelisted", () => {
    const candidates = selectRichOutputCandidates(
      [],
      [sessionFile(ODS_BODY_FILE_NAME, 70447), sessionFile("table.htm", 10)],
    );

    assert.deepEqual(
      candidates.map((candidate) => candidate.file.name),
      ["table.htm"],
    );
  });

  it("is selected while no empty size is known yet", () => {
    const body = sessionFile(ODS_BODY_FILE_NAME, 32425);
    assert.equal(selectOdsBody([body], undefined), body);
  });

  it("is selected at any size other than the known empty one", () => {
    const body = sessionFile(ODS_BODY_FILE_NAME, 70447);
    assert.equal(selectOdsBody([body], 32425), body);
  });

  it("is not selected at the known empty size (Finding 12.16)", () => {
    assert.equal(
      selectOdsBody([sessionFile(ODS_BODY_FILE_NAME, 32425)], 32425),
      undefined,
    );
  });

  it("is selected when the listing carried no size, rather than silently skipped", () => {
    const body = sessionFile(ODS_BODY_FILE_NAME, undefined);
    assert.equal(selectOdsBody([body], 32425), body);
  });

  it("is not selected when absent after the run", () => {
    assert.equal(
      selectOdsBody([sessionFile("sashtml.htm", 70447)], 32425),
      undefined,
    );
  });
});

describe("decodeHtml", () => {
  it("decodes UTF-8, the same text decodeRichOutput gives for text/html", () => {
    const bytes = new TextEncoder().encode("<p>café</p>");
    assert.equal(decodeHtml(bytes), "<p>café</p>");
    assert.deepEqual(decodeRichOutput("text/html", bytes), {
      mime: "text/html",
      data: "<p>café</p>",
    });
  });
});

describe("skippedOdsOutput", () => {
  it("names the SAS output and the reason, not the extension's file", () => {
    const output = skippedOdsOutput("it exceeded the cap");

    assert.equal(output.mime, "text/plain");
    assert.match(output.data, /SAS output/);
    assert.match(output.data, /it exceeded the cap/);
    assert.ok(!output.data.includes(ODS_BODY_FILE_NAME));
    assert.ok(output.data.endsWith("\n"));
  });
});

describe("hasOdsOutput", () => {
  it("is true for a body with an ODS output anchor", () => {
    assert.ok(
      hasOdsOutput(
        '<body class="c body"><div id="IDX" class="systitleandfootercontainer"></div></body>',
      ),
    );
  });

  it("is false for a body holding only styling", () => {
    assert.ok(
      !hasOdsOutput(
        '<html><head><style>.body { margin: 1em }</style></head><body class="c body"></body></html>',
      ),
    );
  });

  it("does not match IDX inside a longer attribute name", () => {
    assert.ok(!hasOdsOutput('<div data-id="IDX1"></div>'));
  });
});

describe("exceedsCaptureCap", () => {
  it("is false under the cap", () => {
    assert.equal(exceedsCaptureCap(sessionFile("plot.png", 1000)), false);
  });

  it("is false exactly at the cap", () => {
    assert.equal(
      exceedsCaptureCap(sessionFile("plot.png", MAX_CAPTURE_BYTES)),
      false,
    );
  });

  it("is true one byte over the cap", () => {
    assert.equal(
      exceedsCaptureCap(sessionFile("plot.png", MAX_CAPTURE_BYTES + 1)),
      true,
    );
  });

  it("is true when the listing carried no size at all", () => {
    // Treated as "cannot confirm it is safe", not as "assume it is small" —
    // see this function's own doc comment.
    assert.equal(exceedsCaptureCap(sessionFile("plot.png", undefined)), true);
  });
});

describe("decodeRichOutput", () => {
  it("base64-encodes a real PNG's bytes with no data-URI prefix", () => {
    const bytes = readFixtureBytes("rich-output", "tiny.png");

    const output = decodeRichOutput("image/png", bytes);

    assert.equal(output.mime, "image/png");
    assert.ok(!output.data.startsWith("data:"));
    // Round-trips back to the exact same bytes byte for byte — the property
    // that matters, given `client.ts`'s `rawBody` exists specifically so
    // this content never passed through a lossy text decode on the way in.
    // Compared as plain number arrays, not the typed arrays themselves:
    // `readFixtureBytes` returns what `readFileSync` actually hands back, a
    // `Buffer`, and `assert.deepEqual` from `node:assert/strict` is really
    // `deepStrictEqual` — which treats a `Buffer` and a plain `Uint8Array`
    // holding identical bytes as unequal, since it distinguishes them by
    // constructor, not just content.
    assert.deepEqual([...Buffer.from(output.data, "base64")], [...bytes]);
  });

  it("UTF-8-decodes an HTML file's bytes as text", () => {
    const bytes = new TextEncoder().encode(
      "<table><tr><td>café</td></tr></table>",
    );

    const output = decodeRichOutput("text/html", bytes);

    assert.equal(output.mime, "text/html");
    assert.equal(output.data, "<table><tr><td>café</td></tr></table>");
  });
});

describe("skippedCaptureOutput", () => {
  it("names the file and the reason, as text/plain", () => {
    const output = skippedCaptureOutput("huge.png", "it exceeded the cap");

    assert.equal(output.mime, "text/plain");
    assert.match(output.data, /huge\.png/);
    assert.match(output.data, /it exceeded the cap/);
    assert.ok(output.data.endsWith("\n"));
  });
});

// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  escapeHtml,
  formatOptionalNumber,
  formatOptionalText,
  formatOptionalTimestamp,
  formatTimestamp,
} from "../../src/data/tablePropertiesModel";

describe("data/tablePropertiesModel", () => {
  describe("escapeHtml", () => {
    it("escapes the five HTML-significant characters", () => {
      assert.equal(
        escapeHtml(`<b>"Tom & Jerry's" show</b>`),
        "&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot; show&lt;/b&gt;",
      );
    });

    it("passes an ordinary string through unchanged", () => {
      assert.equal(escapeHtml("Student Data"), "Student Data");
    });
  });

  describe("formatTimestamp", () => {
    it("parses an ISO-8601 timestamp — Finding 7.19's real shape (verde, SASHELP.CLASS)", () => {
      const formatted = formatTimestamp("2026-03-04T20:36:21.880Z");
      assert.equal(
        formatted,
        new Date("2026-03-04T20:36:21.880Z").toLocaleString(),
      );
    });

    it("falls back to the raw SAS epoch-seconds reading for a plain number no deployment has actually sent — defensive parity with upstream's own formatDate, not a confirmed-reachable path", () => {
      // 2,000,000,000 seconds after 1960-01-01T00:00:00Z is 2023-05-18T03:33:20Z
      // — computed independently (date arithmetic, not this function's own
      // 315619200 offset constant), so a wrong constant in the code under test
      // would actually fail this assertion rather than passing by construction.
      const formatted = formatTimestamp("2000000000");
      assert.equal(
        formatted,
        new Date("2023-05-18T03:33:20.000Z").toLocaleString(),
      );
    });

    it("returns the original string when it parses as neither a date nor a number", () => {
      assert.equal(formatTimestamp("not a timestamp"), "not a timestamp");
    });
  });

  describe("formatOptionalText", () => {
    it("HTML-escapes a present value", () => {
      assert.equal(formatOptionalText("<x>"), "&lt;x&gt;");
    });

    it("renders an empty cell for an absent value", () => {
      assert.equal(formatOptionalText(undefined), "");
    });
  });

  describe("formatOptionalNumber", () => {
    it("locale-formats a present value", () => {
      assert.equal(formatOptionalNumber(1234), (1234).toLocaleString());
    });

    it("renders an empty cell for an absent value", () => {
      assert.equal(formatOptionalNumber(undefined), "");
    });
  });

  describe("formatOptionalTimestamp", () => {
    it("formats and HTML-escapes a present value", () => {
      // A locale-formatted date never actually contains an HTML-significant
      // character, but this still confirms the two are composed, not just
      // that formatTimestamp alone works (already covered above).
      assert.equal(
        formatOptionalTimestamp("2026-03-04T20:36:21.880Z"),
        escapeHtml(new Date("2026-03-04T20:36:21.880Z").toLocaleString()),
      );
    });

    it("renders an empty cell for an absent value", () => {
      assert.equal(formatOptionalTimestamp(undefined), "");
    });
  });
});

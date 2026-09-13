// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * `src/cas/connectSnippet.ts` (8b) — the plain-string builder,
 * `vscode`-free. `src/cas/casConnectCommand.ts`'s own integration test
 * covers how a real editor receives the result.
 */

import assert from "node:assert/strict";

import { buildCasConnectSnippet } from "../../src/cas/connectSnippet";

describe("buildCasConnectSnippet", () => {
  it("reads the token file by name, then connects over the binary transport", () => {
    const snippet = buildCasConnectSnippet({
      host: "sas-cas-server-default-client",
      port: 5570,
      filerefName: "CT000001",
    });

    assert.equal(
      snippet,
      [
        'with open("CT000001") as _cas_token_file:',
        "    _cas_token = _cas_token_file.read().strip()",
        "import swat",
        'conn = swat.CAS("sas-cas-server-default-client", 5570, password=_cas_token)',
      ].join("\n"),
    );
  });

  it("escapes a host that would otherwise break out of the string literal", () => {
    const snippet = buildCasConnectSnippet({
      host: 'weird"host\\name',
      port: 8777,
      filerefName: "CT000002",
    });

    assert.match(snippet, /swat\.CAS\("weird\\"host\\\\name", 8777,/);
  });

  it("escapes an embedded newline in the host", () => {
    const snippet = buildCasConnectSnippet({
      host: "a\nb",
      port: 1,
      filerefName: "CT000003",
    });

    assert.match(snippet, /swat\.CAS\("a\\nb", 1,/);
    assert.equal(snippet.split("\n").length, 4);
  });

  it("interpolates the port as a bare number, not a quoted string", () => {
    const snippet = buildCasConnectSnippet({
      host: "h",
      port: 5570,
      filerefName: "CT000004",
    });

    assert.match(snippet, /swat\.CAS\("h", 5570, password=_cas_token\)/);
  });
});

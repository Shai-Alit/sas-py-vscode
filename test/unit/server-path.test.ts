// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  baseName,
  chooseNavigationSetting,
  encodeServerPath,
  HOME_LABEL,
  isFileNavigationRoot,
  isWithinServerPath,
  joinServerPath,
  navigationRoot,
  normaliseServerPath,
  parentServerPath,
  parseServerUri,
  SERVER_FOLDER_SCHEME,
  SERVER_SCHEME,
  serverFilesHref,
  serverUriString,
} from "../../src/server/path";

/**
 * ADR-0047's one composed URL. The expected encodings are the hrefs the
 * server itself returned on `verde` (Findings 13.22 and 13.28), so a change
 * here that still "looks right" but differs from the server fails.
 */

const SESSION = "/compute/sessions/0a1b2c3d-ses0000";

describe("encodeServerPath", () => {
  it("writes the root as ~fs~", () => {
    assert.equal(encodeServerPath("/"), "~fs~");
    assert.equal(encodeServerPath(""), "~fs~");
  });

  it("matches the server's own hrefs (Findings 13.22 and 13.28)", () => {
    assert.equal(encodeServerPath("/tmp"), "~fs~tmp");
    assert.equal(
      encodeServerPath("/tmp/probe13o_1/x;y~z#q.txt"),
      "~fs~tmp~fs~probe13o_1~fs~x~sc~y~~z%23q.txt",
    );
    assert.equal(
      encodeServerPath("/tmp/probe13p_1/a b é.py"),
      "~fs~tmp~fs~probe13p_1~fs~a%20b%20%C3%A9.py",
    );
  });

  it("doubles a ~ before writing ~sc~, so a name holding ~fs~ stays one segment", () => {
    assert.equal(encodeServerPath("/a~fs~b"), "~fs~a~~fs~~b");
    assert.equal(encodeServerPath("/a;b"), "~fs~a~sc~b");
  });

  it("percent-encodes what a URL path cannot carry", () => {
    assert.equal(encodeServerPath("/a?b&c+d%e"), "~fs~a%3Fb%26c%2Bd%25e");
  });
});

describe("serverFilesHref", () => {
  it("appends /files/ and the encoded path to the session's own href", () => {
    assert.equal(
      serverFilesHref(SESSION, "/mnt/shared"),
      `${SESSION}/files/~fs~mnt~fs~shared`,
    );
    assert.equal(serverFilesHref(`${SESSION}/`, "/"), `${SESSION}/files/~fs~`);
  });
});

describe("normaliseServerPath, joinServerPath and baseName", () => {
  it("makes a path absolute, without empty, . or trailing segments", () => {
    assert.equal(normaliseServerPath(" /mnt//shared/./x/ "), "/mnt/shared/x");
    assert.equal(normaliseServerPath("tmp/x"), "/tmp/x");
    assert.equal(normaliseServerPath("/"), "/");
    assert.equal(normaliseServerPath("/a/../b"), "/a/../b");
  });

  it("joins under the root without a doubled slash", () => {
    assert.equal(joinServerPath("/", "tmp"), "/tmp");
    assert.equal(joinServerPath("/tmp", "x.py"), "/tmp/x.py");
  });

  it("names the last segment, or nothing for the root", () => {
    assert.equal(baseName("/tmp/x.py"), "x.py");
    assert.equal(baseName("/"), "");
    assert.equal(baseName("x"), "x");
  });
});

describe("navigationRoot", () => {
  it("starts USER and SYSTEM at / with the Home label (Finding 13.21)", () => {
    for (const root of ["USER", "SYSTEM"] as const) {
      assert.deepEqual(
        navigationRoot({ root, customPath: "/ignored", setBy: "profile" }),
        { path: "/", label: HOME_LABEL, setBy: "profile", custom: false },
      );
    }
  });

  it("starts CUSTOM at its path, labelled by its last segment", () => {
    assert.deepEqual(
      navigationRoot({
        root: "CUSTOM",
        customPath: "/mnt/shared/",
        setBy: "context",
      }),
      { path: "/mnt/shared", label: "shared", setBy: "context", custom: true },
    );
  });

  it("reads an empty custom path as /, still labelled Home", () => {
    assert.deepEqual(navigationRoot({ root: "CUSTOM", setBy: "profile" }), {
      path: "/",
      label: HOME_LABEL,
      setBy: "profile",
      custom: true,
    });
  });
});

describe("chooseNavigationSetting", () => {
  it("uses the profile's setting when the context sets neither attribute", () => {
    assert.deepEqual(
      chooseNavigationSetting(
        { root: "CUSTOM", customPath: "/p" },
        {
          reuseServerProcesses: "true",
        },
      ),
      { root: "CUSTOM", customPath: "/p", setBy: "profile" },
    );
    assert.deepEqual(chooseNavigationSetting({}, undefined), {
      root: "USER",
      customPath: undefined,
      setBy: "profile",
    });
  });

  it("lets the context's pair win when it sets either one", () => {
    assert.deepEqual(
      chooseNavigationSetting(
        { root: "SYSTEM" },
        { fileNavigationRoot: "CUSTOM", fileNavigationCustomRootPath: "/c" },
      ),
      { root: "CUSTOM", customPath: "/c", setBy: "context" },
    );
    assert.deepEqual(
      chooseNavigationSetting(
        { root: "CUSTOM", customPath: "/p" },
        { fileNavigationCustomRootPath: "/c" },
      ),
      { root: "USER", customPath: "/c", setBy: "context" },
    );
  });

  it("ignores a context root it does not recognise", () => {
    assert.deepEqual(
      chooseNavigationSetting(
        { root: "SYSTEM" },
        { fileNavigationRoot: "custom", fileNavigationCustomRootPath: "" },
      ),
      { root: "SYSTEM", customPath: undefined, setBy: "profile" },
    );
  });

  it("recognises upstream's three spellings only", () => {
    assert.equal(isFileNavigationRoot("CUSTOM"), true);
    assert.equal(isFileNavigationRoot("user"), false);
    assert.equal(isFileNavigationRoot(undefined), false);
  });
});

describe("serverUriString and parseServerUri", () => {
  const query = (uri: string): string => uri.slice(uri.indexOf("?") + 1);

  it("round-trips a profile id and path holding the characters a query splits on", () => {
    const parts = {
      profileId: "My profile & co+1",
      path: "/tmp/a&b+c=d%e #f?.py",
    };
    const uri = serverUriString(parts);
    assert.ok(uri.startsWith(`${SERVER_SCHEME}:/a&b+c=d%25e %23f%3F.py?`));
    assert.deepEqual(parseServerUri(query(uri)), parts);
  });

  it("survives the percent-decoding vscode.Uri applies to a query", () => {
    const parts = { profileId: "p", path: "/tmp/é x.py" };
    const decoded = decodeURIComponent(query(serverUriString(parts)));
    assert.deepEqual(parseServerUri(decoded), parts);
  });

  it("writes a folder's identity URI under the folder scheme", () => {
    assert.ok(
      serverUriString(
        { profileId: "p", path: "/tmp" },
        SERVER_FOLDER_SCHEME,
      ).startsWith(`${SERVER_FOLDER_SCHEME}:/tmp?`),
    );
  });

  it("refuses a query this extension did not write", () => {
    for (const bad of [
      "",
      "p=cA&path=",
      "p=&path=L3Q",
      "p=cA",
      "p=*&path=L3Q",
    ]) {
      assert.equal(parseServerUri(bad), undefined, bad);
    }
  });
});

describe("parentServerPath and isWithinServerPath", () => {
  it("gives a path's folder, and / for a top-level path or the root", () => {
    assert.equal(parentServerPath("/tmp/x/a.py"), "/tmp/x");
    assert.equal(parentServerPath("/tmp"), "/");
    assert.equal(parentServerPath("/"), "/");
  });

  it("reads a path as within itself and its ancestors, not a sibling sharing a prefix", () => {
    assert.equal(isWithinServerPath("/a/b", "/a"), true);
    assert.equal(isWithinServerPath("/a", "/a"), true);
    assert.equal(isWithinServerPath("/ab", "/a"), false);
    assert.equal(isWithinServerPath("/a", "/a/b"), false);
    assert.equal(isWithinServerPath("/anything", "/"), true);
  });
});

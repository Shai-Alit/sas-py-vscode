// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  readLocalPackages,
  type LocalPackageFs,
} from "../../src/run/localPackages";

/** A `site-packages` tree, expressed as directory listings keyed by path and
 * file contents keyed by path — the fixture every test below builds instead
 * of touching a real local Python install. */
function fakeFs(tree: {
  readonly dirs: Readonly<Record<string, readonly string[]>>;
  readonly files: Readonly<Record<string, string>>;
}): LocalPackageFs {
  return {
    readdir: (path) => {
      const entries = tree.dirs[path];
      if (entries === undefined)
        return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(entries);
    },
    readFile: (path) => {
      const text = tree.files[path];
      if (text === undefined)
        return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(text);
    },
  };
}

describe("localPackages.ts — reading a local site-packages tree", () => {
  it("reads Name/Version out of a dist-info's METADATA file", async () => {
    const fs = fakeFs({
      dirs: { "/site-packages": ["numpy-2.0.0.dist-info"] },
      files: {
        "/site-packages/numpy-2.0.0.dist-info/METADATA":
          "Metadata-Version: 2.1\nName: numpy\nVersion: 2.0.0\nSummary: array library\n",
      },
    });

    const packages = await readLocalPackages("/site-packages", fs);

    assert.deepEqual(packages, [{ name: "numpy", version: "2.0.0" }]);
  });

  it("reads Name/Version out of an egg-info's PKG-INFO file", async () => {
    const fs = fakeFs({
      dirs: { "/site-packages": ["olddep-1.2.egg-info"] },
      files: {
        "/site-packages/olddep-1.2.egg-info/PKG-INFO":
          "Metadata-Version: 1.0\nName: olddep\nVersion: 1.2\n",
      },
    });

    const packages = await readLocalPackages("/site-packages", fs);

    assert.deepEqual(packages, [{ name: "olddep", version: "1.2" }]);
  });

  it("skips a non-dist-info, non-egg-info entry", async () => {
    const fs = fakeFs({
      dirs: { "/site-packages": ["__pycache__", "numpy"] },
      files: {},
    });

    const packages = await readLocalPackages("/site-packages", fs);

    assert.deepEqual(packages, []);
  });

  it("skips an entry whose metadata file cannot be read, rather than failing the whole read", async () => {
    const fs = fakeFs({
      dirs: {
        "/site-packages": ["broken-1.0.dist-info", "pandas-3.0.0.dist-info"],
      },
      files: {
        "/site-packages/pandas-3.0.0.dist-info/METADATA":
          "Name: pandas\nVersion: 3.0.0\n",
        // broken-1.0.dist-info/METADATA is deliberately absent.
      },
    });

    const packages = await readLocalPackages("/site-packages", fs);

    assert.deepEqual(packages, [{ name: "pandas", version: "3.0.0" }]);
  });

  it("skips a metadata file missing Name or Version, rather than failing the whole read", async () => {
    const fs = fakeFs({
      dirs: {
        "/site-packages": ["noversion-1.0.dist-info", "ok-1.0.dist-info"],
      },
      files: {
        "/site-packages/noversion-1.0.dist-info/METADATA": "Name: noversion\n",
        "/site-packages/ok-1.0.dist-info/METADATA": "Name: ok\nVersion: 1.0\n",
      },
    });

    const packages = await readLocalPackages("/site-packages", fs);

    assert.deepEqual(packages, [{ name: "ok", version: "1.0" }]);
  });

  it("returns no packages, not an error, for a site-packages path that does not exist", async () => {
    const fs = fakeFs({ dirs: {}, files: {} });

    const packages = await readLocalPackages("/nowhere", fs);

    assert.deepEqual(packages, []);
  });

  it("trims trailing whitespace off a header value without eating an inner space", async () => {
    const fs = fakeFs({
      dirs: { "/site-packages": ["spaced-1.0.dist-info"] },
      files: {
        "/site-packages/spaced-1.0.dist-info/METADATA":
          "Name: my spaced name  \nVersion: 1.0 \n",
      },
    });

    const packages = await readLocalPackages("/site-packages", fs);

    assert.deepEqual(packages, [{ name: "my spaced name", version: "1.0" }]);
  });
});

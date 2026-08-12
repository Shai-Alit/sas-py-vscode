// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // Every entry here is already in .gitignore, and that is not enough: flat
  // config does not read .gitignore, so an ignored build artefact is still a
  // lintable file as far as ESLint is concerned. (Prettier 3 *does* read
  // .gitignore by default, which is why .prettierignore is shorter — the two
  // files disagreeing is expected, not an oversight.)
  //
  // `.vscode-test/` is the one that bites. `npm run test:integration` downloads
  // a full VS Code build into it — about a gigabyte, including multi-megabyte
  // minified bundles — and linting those exhausts the V8 heap and kills the
  // process. Symptom: `npm run lint` worked yesterday and today dies with
  // "FATAL ERROR: Reached heap limit", on a tree with no source changes.
  {
    ignores: [
      "dist/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      ".vscode-test/**",
      ".vscode-test-web/**",
      "test/scratch/**",
    ],
  },

  // Type-aware linting for the extension source.
  {
    files: ["src/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // --- Rules that encode CONTRIBUTING.md, so review time is spent on
      // --- judgement rather than on things a machine can check.

      // "No console.log in shipped code. Use the output channel."
      "no-console": "error",

      // "No empty catch." The sanctioned fail-soft exception in capability
      // probing must contain an explanatory comment, which satisfies this rule.
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Unhandled rejections silently swallow failures.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/return-await": ["error", "always"],

      // Keeps `as any` from laundering unvalidated data across API boundaries.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  // Spans src and test on purpose. Upstream's PKCE verifier uses Math.random(),
  // and ported security code is audited rather than transcribed — so the
  // specific defect is made unmergeable.
  //
  // Tests need this at least as much as `src/` does. The obvious way to give a
  // mutating live test the per-run unique name CONTRIBUTING.md requires is
  // `Math.random()`, and a collision there means two runs fighting over the same
  // object on somebody's real deployment.
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Math.random() is not cryptographically secure, and collides more often than people expect. Use crypto.randomUUID() for unique names, or crypto.randomBytes()/crypto.getRandomValues() for anything security-sensitive (this is the exact defect present in the upstream SAS extension's PKCE verifier).",
        },
      ],
    },
  },

  // "Never branch on Viya version outside src/dialects/." Enforced structurally
  // rather than left to review, because it is the rule most likely to be broken
  // by someone in a hurry who does not yet know the dialect layer exists.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/dialects/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Side-agnostic on purpose: `"4" === profile.version` is the same
          // mistake as `profile.version === "4"`, and a guard that only catches
          // one of them is a guard you cannot rely on.
          selector:
            "BinaryExpression[operator=/^[!=]==?$/]:matches([left.property.name=/^(version|viyaVersion|generation)$/], [right.property.name=/^(version|viyaVersion|generation)$/], [left.name=/^(version|viyaVersion|generation)$/], [right.name=/^(version|viyaVersion|generation)$/])",
          message:
            "Viya version branching belongs in src/dialects/. Add a dialect method instead of comparing a version field here.",
        },
        {
          selector:
            "BinaryExpression[operator=/^[!=]==?$/] > Literal[value=/^3\\.5$/]",
          message:
            'Viya version branching belongs in src/dialects/. Add a dialect method instead of comparing against "3.5" here.',
        },
        {
          // `switch (profile.version) { case "3.5": ... }` is version branching
          // too, and is not a BinaryExpression, so the rules above miss it.
          selector:
            "SwitchStatement > :matches(MemberExpression[property.name=/^(version|viyaVersion|generation)$/], Identifier[name=/^(version|viyaVersion|generation)$/])",
          message:
            "Viya version branching belongs in src/dialects/. Switching on a version field is still branching — add a dialect method.",
        },
      ],
    },
  },

  // Tests get the same type-aware rule sets as the source they exercise. A test
  // that only compiles under looser rules is testing something the extension
  // cannot do.
  //
  // Two rules deliberately differ, and both differences are listed here rather
  // than left to be inferred from which block a rule happens to sit in:
  // `no-console` is off (below), and the version-branching selectors do not
  // apply. That second one is not an oversight — the dialect layer's own tests
  // and `test/helpers/live-gate.ts` have to name a generation to choose a
  // fixture or an environment variable, which is the one place branching on a
  // version is the point rather than the bug.
  //
  // The Math.random ban applies here too; it lives in the shared block above.
  //
  // Type information comes from tsconfig.test.json rather than the project
  // service, because the nearest tsconfig.json to `test/` is the extension's,
  // and that one deliberately does not include test files.
  {
    files: ["test/**/*.ts"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.mocha },
    },
    rules: {
      // A test runner reports to a terminal. There is no output channel here,
      // and no user to protect from it.
      "no-console": "off",

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },

  // Build and tooling scripts: plain ESM, no type information available.
  {
    files: ["**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Build scripts legitimately report progress to stdout.
      "no-console": "off",
    },
  },

  // Must stay last: turns off everything Prettier owns.
  prettier,
);

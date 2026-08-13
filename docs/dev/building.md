# Building and debugging

What you need installed, how the build fits together, and why it is shaped this
way. For the rules that get a change rejected, see [CONTRIBUTING.md](https://github.com/Shai-Alit/sas-py-vscode/blob/main/CONTRIBUTING.md).

## Prerequisites

Node 22 (see `.nvmrc`) and a recent VS Code. Nothing else — in particular **no
local Python**. That is a product constraint, not an accident: the extension
talks to Viya over REST and never shells out to an interpreter, so a contributor
with no Python on their machine can still build, test, and debug everything.

```bash
npm install
npm run verify
```

`verify` is the whole gate, and CI runs this exact command — see `docs/dev/ci.md`:

```
format:check → lint → typecheck → check:copyright → check:secrets →
check:coverage-scope → build → coverage
```

Run it before you push. If it passes locally it passes in CI; if it does not,
that divergence is a bug in the toolchain and worth reporting.

The last step runs the unit tests under c8 and enforces the coverage ratchet.
The integration and live tiers are not in `verify` — one needs a display and the
other needs a real deployment. See [testing.md](testing.md).

## Install scripts, and why your install differs from CI's

Nothing in this dependency tree is allowed to run code at install time. The
policy is the `allowScripts` field in `package.json`, and every package that can
run a script — `@vscode/vsce-sign`, `esbuild` (at two versions), `fsevents`,
`keytar`, `msw` — is denied. The reasoning is
[ADR-0005](../adr/0005-supply-chain-policy.md); the short version is that this is
the cheapest supply-chain attack there is, and denying them was proven harmless
by running the real build, test, docs and package commands against a clean
install with them blocked.

If you add a dependency that ships an install script, `npm run test:unit` will
fail until you record a decision about it in `allowScripts` — a unit test reads
`package-lock.json` and compares. Record it with
`npm install-scripts deny <pkg>` rather than editing the field by hand.

**Your `npm install` almost certainly ignores that policy, and so does every CI
job but one.** `allowScripts` is understood only by npm 12 and later, npm 12
requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`, and no Node release bundles it
— Node 26 still ships npm 11.x. The policy is enforced in exactly one place, the
`supply-chain` CI job, which installs npm 12 explicitly. That job is the gate on
what may enter the lockfile; it is not a claim about how your laptop installed
anything.

Two consequences worth internalising:

- **Do not trust `npm config get strict-allow-scripts`.** npm 10 accepts that key
  from `.npmrc` and reports it as `true` while implementing nothing at all. It
  will tell you the control is on when it is not.
- `.nvmrc` says `22`, unpinned, so CI resolves the newest 22.x and satisfies npm
  12's floor. If that ever gets pinned to an exact version below **22.22.2**, the
  `supply-chain` job stops being able to install npm 12 and will fail on the
  install step rather than on anything to do with your change.

If `npm ci` warns that install scripts were blocked and names a package you have
not seen before, that is the control working — a new dependency wants to run code
on your machine. Look at it, then record a decision:

```bash
npm install-scripts ls              # what wants to run, and from where
npm install-scripts deny <package>  # the default answer
npm install-scripts approve <package>
```

Let those commands write the `package.json` entry rather than hand-editing it,
and say in the pull request why an approval is necessary — that is the one part
of this a reviewer cannot check mechanically.

## The inner loop

Press <kbd>F5</kbd>. That runs the `watch` build task and opens a second VS Code
window — the Extension Development Host — with the extension loaded from source.
Breakpoints work in the original window against the TypeScript, because the
non-production build emits linked source maps.

There is a second launch configuration, **Run Extension (untrusted workspace)**,
which starts the host with workspace trust disabled. Use it whenever you touch
anything under `capabilities.untrustedWorkspaces`; the restricted-configuration
behaviour described in [ADR-0002](../adr/0002-workspace-trust-posture.md) is
invisible in a trusted window, which is exactly how that class of bug ships.

`Ctrl`/`Cmd`+`R` in the host window reloads it after a rebuild.

## What the pieces do

**esbuild** (`esbuild.mjs`) bundles `src/extension.ts` into a single CommonJS
file at `dist/extension.js`, targeting Node 20 with `vscode` marked external —
the host provides that module at runtime, and bundling it breaks loading. Only
`dist/` ships; `.vscodeignore` keeps `src/`, tests, and config out of the VSIX,
which is why the packaged extension is a few kilobytes rather than a few
megabytes.

**tsc** never emits anything that ships. esbuild strips types without checking
them, so type errors would otherwise sail straight into a bundle. `npm run
typecheck` is the only thing that actually type-checks, which is why it is in
`verify` and why a build passing is not evidence of anything. It checks two
projects: `tsconfig.json` for the extension, and `tsconfig.test.json` for the
extension *and* the tests. The tests do emit — to `out/`, for Mocha to run — via
`npm run compile:test`; `out/` is git-ignored and never packaged.

**ESLint** (`eslint.config.mjs`) is type-aware, and deliberately encodes several
`CONTRIBUTING.md` rules as lint errors rather than leaving them to review:

- `no-console` — shipped code logs through the output channel, not stdout.
- `no-empty` with `allowEmptyCatch: false` — silent failure is banned.
- `Math.random` is restricted, naming the upstream PKCE defect in the message.
- Three `no-restricted-syntax` selectors reject Viya version comparisons
  everywhere except `src/dialects/` — a comparison on either side, a comparison
  against the literal `"3.5"`, and a `switch` on a version field.

A rule you can lint for is a rule you stop arguing about. If you have a
legitimate reason to break one, disable it on the line with a comment saying
why — a reviewer will read that comment.

**Prettier** owns formatting; ESLint does not. `eslint-config-prettier` comes
last in the config to switch off anything stylistic, so the two never fight.

**`scripts/check-copyright.mjs`** enforces the licence obligations. Every source
file needs a copyright line and an SPDX identifier. Any file that names
`sassoftware/vscode-sas-extension` in its header must declare the relationship
on a line beginning `Ported from:` or `Structure follows:`, and a `Ported from:`
file must additionally carry a modification notice — Apache-2.0 §4(b) requires
it, and preserving the SAS header alone does not satisfy it.

That third rule exists because the first two could only catch the careful
mistake. They key off the presence of the SAS copyright header, so a ported file
that dropped the header entirely passed silently. Requiring the file to say what
it is inverts that. The check cannot tell whether the declaration is *true* —
nothing mechanical can — but a claim that is present and specific is reviewable,
where an absent one gets inferred differently by every reader.

The check reads only the leading comment block, so mentioning SAS Institute in
the body of a file is fine, and the declaration markers must begin a line so
that a file *discussing* the rule is not caught by it. This file's own checker
was the first thing to trip that.

**`scripts/check-secrets.mjs`** looks for credential-shaped strings in the
tracked working tree — a JWT, a literal `Authorization` header, a PEM private
key, a credential-named field assigned a literal, a password in a URL. It is in
`verify` rather than only in CI because it needs no network and no credentials,
and a check that only exists in CI is a check contributors meet for the first
time when it fails. If it flags something that is not a credential, put
`credential-scan: allow` and a reason in a comment on that line or the line
above; if it flags something that *is* one, rotate it before you delete it,
because removing the line does not un-publish it. The reasoning is
[ADR-0006](../adr/0006-scanning-posture.md) and the details are in
[ci.md](ci.md).

## Localisation

User-facing strings go through `vscode.l10n.t()`. `npm run l10n:extract`
regenerates `l10n/bundle.l10n.json` from the source; that file is generated and
git-ignored, and `vscode:prepublish` regenerates it so packaging from a clean
checkout works. Strings in `package.json` are localised the other way, through
`%key%` placeholders resolved from `package.nls.json`.

## Packaging

```bash
npm run package
```

Produces `dist/python-on-viya.vsix`, installable with **Extensions: Install from
VSIX…**, and then runs `npm run check:package` over the archive it just built.

That second half is not optional and not decoration. `.vscodeignore` is
allow-by-default — every file in your working tree ships unless a pattern
excludes it — and this repository is one where contributors are told to keep a
`creds.json` full of live Viya tokens. The checker opens the `.vsix`, refuses
anything shaped like a source file, a source map, an internal document or a
credential, and also insists the files that *should* be there are. Read
[ci.md](ci.md) before changing its rules; several of them are less obvious than
they look, starting with the fact that vsce renames three files on the way in.

## Things that will surprise you

**`types` is listed explicitly in `tsconfig.json`.** TypeScript 6 no longer
auto-discovers every `@types/*` package. Relying on discovery was fragile in
both directions anyway — it lets a transitive devDependency leak DOM or test
globals into the extension's type space, so code type-checks against globals
that do not exist at runtime. If you add a dependency whose types you need
globally, add it to that list.

**`typescript` is pinned below 7.** `typescript-eslint` declares a peer range
that excludes it. Upgrading TypeScript past the range does not fail loudly; it
silently disables every type-aware lint rule, which is most of the value in the
config. Upgrade both together, and check `npm ls typescript-eslint` afterwards.

**`node_modules` is not portable across platforms.** esbuild ships a native
binary per platform, so a tree installed under WSL or a Linux container and then
used from Windows fails with *"You installed esbuild for another platform than
the one you're currently using"*. Nothing is corrupt; the wrong optional package
is on disk. Run `npm ci` on the platform you are building from. The lockfile
records all 26 esbuild targets, so `npm ci` is always sufficient and never needs
a lockfile change. If you genuinely alternate between two platforms against one
checkout, `npm install --no-save @esbuild/<platform>` adds the second binary
without touching `package.json` or the lockfile — esbuild picks the right one at
runtime when both are present.

**ESLint does not read `.gitignore`.** Flat config has one ignore list, in
`eslint.config.mjs`, and it has to repeat every generated directory by hand.
Prettier 3 reads `.gitignore` by default, which is why `.prettierignore` is much
shorter — the two files disagreeing is expected. The failure mode is memorable:
after the first `npm run test:integration`, `.vscode-test/` holds about a
gigabyte of downloaded VS Code, and linting its minified bundles kills the
process with *"FATAL ERROR: Reached heap limit"* on a tree whose source has not
changed. `test/unit/eslint-ignores.test.ts` asserts the ignores through ESLint's
own resolver so the two lists cannot drift apart again.

**`activationEvents` is empty, on purpose.** Since VS Code 1.74, a command
declared in `contributes.commands` activates its extension implicitly — the
[activation events reference](https://code.visualstudio.com/api/references/activation-events)
states plainly that "commands contributed by your extension do not require a
corresponding `onCommand` activation event declaration". We require `^1.104.0`,
and the upstream SAS extension ships 52 commands and zero `onCommand` entries.
This gets flagged as a bug by people (and review bots) working from
pre-1.74 habits; it is not one.

Adding `onLanguage:python` would be a genuine mistake for a different reason —
it activates the extension for every Python user on every Python file, the
overwhelming majority of whom have no Viya deployment. Think hard before adding
any activation event, and prefer the narrowest one that works.

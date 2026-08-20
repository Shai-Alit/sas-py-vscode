# Fixtures

Recorded SAS Viya responses, used to drive the mock HTTP layer. Everything the
unit tier knows about Viya, it learned from a file in here.

```
viya4/                 captured from a live Viya 4 deployment
viya35/                captured from a live Viya 3.5 deployment
harness/               synthetic; proves the plumbing, imitates nothing
submission-corpus/     hand-written Python, hostile to SAS tokenisation
```

The split by generation is the point. Happy paths run once per generation, so a
change that quietly works only on Viya 4 fails the 3.5 suite instead of shipping
and being discovered by a customer.

## Capture, then sanitise

Capture with the probe workflow described in `CONTRIBUTING.md` — a read-only
request against a real deployment — and save the response body verbatim before
touching it. Then, before the file goes anywhere near a commit, replace:

- **the bearer token** — delete it; it must never reach the file at all
- **hostnames and URLs**, including every `links[].href` — use `viya.example.com`
- **user names** — `createdBy`, `modifiedBy`, `owner`, and anything in a display
  string
- **organisation-identifying ids and names** — context names, library names, and
  folder paths that say where you work
- **absolute filesystem paths** that reveal a deployment layout

Replace with synthetic values that are *structurally faithful*: same type, same
length class, same character set, same null-versus-absent pattern. A UUID becomes
a different UUID, not `"REDACTED"`. The fidelity is the entire value of the
fixture — a sanitised payload that no longer parses like the original tests
nothing.

Keep everything else exactly as the server sent it, including field order, empty
arrays, `null`s, and fields the client does not read. The next person to add a
feature reads this file to find out what is available.

## Rules

**Never hand-write a fixture in `viya4/` or `viya35/`.** Those directories are
evidence. A payload invented from documentation looks identical to a recorded one
and is worth much less, and there is no way to tell them apart six months later.
If you need a shape to test against and cannot capture it, put it in `harness/`
and say in the file what it is.

**`viya4/` and `viya35/` are exempt from Prettier**, so that a captured payload
can be committed exactly as it arrived rather than reflowed on the way in. It is
a formatter, so it cannot change what a fixture means — but a fixture that no
longer matches the output it was captured from is harder to re-verify against the
deployment, and the whole point of these files is that they are evidence.
`harness/` is hand-written and is formatted like the source it is.

**Record where it came from.** A fixture that changes behaviour belongs with a
`PROBE-FINDINGS.md` entry describing the endpoint, the date, and the deployment
generation. Superseded findings are struck through, never deleted.

**Fixtures are read from this directory, not copied into `out/`.** Use
`readJsonFixture` from `test/helpers/fixtures.ts`; there is no build step to
forget, and no stale copy to go green against.

## `submission-corpus/`

A fourth kind, and deliberately not evidence in the sense above: these are
hand-written, not captured, and that is the point of them rather than an
exception to the rule. Phase 3's submission-fidelity corpus
(`RUNBOOK.md`, "Before 3a") is real Python source chosen to be hostile to SAS's
tokeniser — an apostrophe in a docstring, mixed triple-quote styles, an
f-string with nested quotes and braces, raw and byte strings, `&`/`%` in string
literals, the literal token `endsubmit;` inside a comment and inside a string, a
`;`-heavy one-liner, CRLF line endings, a tab-indented file, non-ASCII
identifiers and content, an empty file, and a file with no trailing newline —
see `PRODUCTION_PLAN.md` §4 for why each one is here.

Read every file with no encoding argument (`fs.readFileSync(path)`, not
`readFileSync(path, "utf8")`), so a test asserts on the real bytes rather than a
re-decoded string. `empty.py` is a real zero-byte file, not a placeholder, and
`no-trailing-newline.py`'s last byte is deliberately not `\n` — do not "fix"
either with an editor that adds one on save.

**Two config files exist to keep these bytes intact, and both are load-bearing.**
`.gitattributes` marks the directory `-text`, because the repository-wide
`* text=auto eol=lf` would otherwise rewrite `crlf-line-endings.py` on the way
into a commit — measured: the filtered blob is 51 bytes against the raw 56, so
the only property that fixture has would be deleted on every fresh clone,
including CI, and nowhere else. `.editorconfig` carries the matching exemption
for editors: `end_of_line`, `insert_final_newline` and `trim_trailing_whitespace`
are each a way to destroy a different case on save. If a corpus assertion starts
failing in CI but not locally, or locally but not in CI, look at those two files
before looking at the test.

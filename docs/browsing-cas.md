# Browsing CAS

Once you have [signed in](signing-in.md), the **Python on Viya** activity-bar
icon also shows a **CAS** view — the CAS servers, caslibs and tables your
account can see. Unlike [SAS Libraries](browsing-sas-libraries.md), this view
needs no compute session: it reads CAS directly with your Viya sign-in token,
so it works whether or not you have connected, and shows something the moment
you are signed in.

## What the tree shows

Expanding **CAS** lists every CAS server your account can see; expanding a
server lists its **global** caslibs, and expanding a caslib lists its tables.
Session-scoped, personal caslibs (the kind named after you) are not shown yet
— only global ones are, today.

A table's icon tells you whether CAS has it loaded into memory: a cloud for
data at rest, a table icon once it is loaded. Expanding a table to see its
columns **loads it if it was not already loaded** — CAS has no way to answer
"what columns does this have" without doing so, so this is a deliberate side
effect of expanding the node, not an accident. The icon flips from cloud to
table as the columns appear, so you can see that the load happened without
refreshing anything.

If more than one CAS server exists on your deployment, the tree lists all of
them; most deployments have exactly one.

## Opening a table

Click a table, or right-click it and choose **Open Table**, to open it in the
same scrollable grid [SAS Libraries](browsing-sas-libraries.md#opening-a-table)
uses. Sorting and filtering work the same way from where you sit — click a
column header to sort, type a `WHERE`-clause expression and press Enter to
filter — though the two are simpler underneath for CAS: there is no
server-side view to create or discard, so a sort or filter is just part of
every request rather than something built once and reused.

**Export to CSV** and **Table Properties**, both available for a SAS Libraries
table, are not built yet for a CAS table. Right-click a CAS table and you will
not find either.

## Refreshing

The view does not poll. Use **Python on Viya: Refresh CAS**, or the refresh
button on the view's title bar, after something changes in CAS and you want the
tree to catch up. It also refreshes on sign-in, sign-out, and switching
connection profile.

## Connecting to CAS from your own Python code

Browsing CAS and running Python against CAS are two different things. If your
code needs its own `swat.CAS()` connection — for example to run a CAS action —
see [Connecting to CAS from Python](cas-python-connection.md), which needs an
active compute session the same way any run does.

## When it does not work

- **"Add a SAS Viya connection profile to browse CAS."** No profile is
  configured yet. See [Connection profiles](connection-profiles.md).
- **"Sign in to SAS Viya to browse CAS."** You have a profile but no active
  sign-in. Run **Python on Viya: Sign In** — you do not need to connect first,
  just sign in.
- **Your own CASUSER library is not in the tree.** Expected today — only
  global caslibs are shown; a session-scoped caslib is a known gap for a later
  release.
- **No Export to CSV or Table Properties on a CAS table.** Not built yet —
  both exist for a SAS Libraries table.
- **A filter is refused with CAS's own error message.** CAS rejected the
  `WHERE`-clause syntax itself; the message is CAS's own wording, not this
  extension's.

## Where the details are

- [Python and SAS libraries](data-access.md) and [Connecting to CAS from
  Python](cas-python-connection.md) — the Python-side counterparts to this
  tree.
- [ADR-0033](adr/0033-cas-adapter-shape.md) — why browsing CAS needs no
  compute session, unlike SAS Libraries.
- [ADR-0034](adr/0034-table-source-abstraction.md) — why a CAS table opens in
  the same panel a SAS Libraries table does, and why its sort/filter is
  simpler underneath.
- Probe findings 8.1–8.15 in
  [`docs/phases/phase-8.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-8.md)
  — the live CAS wire shapes this is built from, including the JIT-load
  behaviour.

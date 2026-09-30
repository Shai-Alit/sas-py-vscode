# Release smoke test for the installed Python on Viya extension — Run File.
#
# Not part of any automated suite: nothing in `npm test` reads this directory.
# Open this file with the run target set to a Viya profile and use
# "Python on Viya: Run File". Each check prints PASS / FAIL / SKIP; LOOK lines
# name something to confirm by eye in the Result panel. The run ends with a
# summary, and raises if any check failed (so a failure also lands in the
# Problems panel). See README.md in this folder for the manual checklist.
#
# `SAS` is injected into the interpreter by PROC PYTHON, so Pylance cannot see it.
# pyright: reportUndefinedVariable=false

import os
import sys
import time

_results = []
_looks = []


class Skip(Exception):
    """Raised inside a check to report SKIP rather than FAIL."""


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def check(name):
    """Decorator that runs the function immediately and records its outcome."""

    def run(fn):
        try:
            detail = fn()
            status = "PASS"
        except Skip as exc:
            status, detail = "SKIP", str(exc)
        except Exception as exc:
            status, detail = "FAIL", f"{type(exc).__name__}: {exc}"
        _results.append((status, name))
        print(f"[{status}] {name}" + (f" -- {detail}" if detail else ""), flush=True)
        return fn

    return run


def look(message):
    _looks.append(message)
    print(f"[LOOK] {message}", flush=True)


# Files this run writes for rich-output capture. The extension deletes every
# file it captures, so none of them should survive from a previous run.
CAPTURE_FILES = ["smoke_01_plot.png", "smoke_02_table.html", "smoke_03_sanitizer.html"]

print("=== Python on Viya release smoke test (Run File) ===", flush=True)


# --- 1. Interpreter and session ---------------------------------------------


@check("SAS bridge object is present")
def _():
    expect("SAS" in globals(), "no SAS object: this is not running under PROC PYTHON")
    return f"Python {sys.version.split()[0]}"


@check("SAS release is readable via SAS.symget")
def _():
    release = SAS.symget("SYSVLONG")
    expect(release, "SYSVLONG came back empty")
    return str(release).strip()


@check("Run File starts with a fresh namespace")
def _():
    # Set at the end of this file. If a Run File did not restart the
    # interpreter, the previous run's value would still be here.
    expect(
        "_SMOKE_PY_SENTINEL" not in globals(),
        "sentinel from an earlier run survived (did you Run Selection on the whole file?)",
    )


@check("OBS option did not carry over from the previous run")
def _():
    # The end of this file sets `options obs=0;`. Every job the extension
    # submits resets OBS to MAX when it is 0, so the next run must not see 0.
    SAS.submit("%let _smoke_obs=%sysfunc(getoption(obs));")
    obs = str(SAS.symget("_smoke_obs")).strip()
    expect(obs != "0", "OBS is 0: the per-job reset did not happen")
    return f"OBS={obs} (meaningful on the second and later runs)"


@check("No leftover capture files from a previous run")
def _():
    leftovers = [name for name in CAPTURE_FILES if os.path.exists(name)]
    expect(not leftovers, f"still present: {', '.join(leftovers)} (fine if the last run was cancelled)")


# --- 2. Submission fidelity -------------------------------------------------
# The source is uploaded as a file, never pasted into a SAS submit block, so
# none of these literals may be altered or terminate the procedure early.

_TRAP = """
endsubmit;
run;
quit;
"""


@check("endsubmit; / run; inside a string survive unchanged")
def _():
    expect(_TRAP == "\n" + "end" + "submit;\nrun;\nquit;\n", repr(_TRAP))


@check("SAS macro triggers inside strings are not resolved")
def _():
    text = "&sysuserid and %macro and %let x=1;"
    expect(text == "&" + "sysuserid and " + "%" + "macro and " + "%" + "let x=1;", repr(text))


@check("Non-ASCII text survives the round trip")
def _():
    text = "café ✓ 日本語 — ünïcödé"
    expected = "café ✓ 日本語 — ünïcödé"
    expect(text == expected, f"got {text!r}")


def _docstring_with_apostrophe():
    """Don't trip on an odd number of 'quotes'."""
    return "ok"


@check("Docstring with apostrophes and odd quote count")
def _():
    expect(_docstring_with_apostrophe() == "ok", "unexpected return")


# --- 3. Printed output ------------------------------------------------------
# PROC PYTHON holds a step's stdout until the step ends, even with flush=True,
# so these lines arrive with the rest of the run's output, not one at a time
# (Finding 13.3 in docs/phases/phase-13.md).


@check("stdout arrives complete and in order")
def _():
    for i in range(1, 6):
        print(f"    printed line {i}/5", flush=True)
        time.sleep(0.5)


look("Output channel: the five 'printed line' lines in order 1-5, arriving with the rest of the run's output when it ends")


# --- 4. SAS <-> Python data exchange ----------------------------------------

_class_df = None


@check("SAS.sd2df reads sashelp.class")
def _():
    global _class_df
    _class_df = SAS.sd2df("sashelp.class")
    expect(_class_df.shape == (19, 5), f"shape {_class_df.shape}, expected (19, 5)")
    columns = {c.lower() for c in _class_df.columns}
    expect(columns == {"name", "sex", "age", "height", "weight"}, f"columns {sorted(columns)}")


@check("SAS.df2sd writes work.smoke_class and it reads back")
def _():
    if _class_df is None:
        raise Skip("sd2df failed above")
    out = _class_df.copy()
    out["BMI"] = out["Weight"] / (out["Height"] ** 2) * 703
    SAS.df2sd(out, "work.smoke_class")
    back = SAS.sd2df("work.smoke_class")
    expect(len(back) == 19, f"{len(back)} rows read back")
    expect("bmi" in {c.lower() for c in back.columns}, f"columns {list(back.columns)}")
    bmi = [c for c in back.columns if c.lower() == "bmi"][0]
    expect(abs(back[bmi].sum() - out["BMI"].sum()) < 1e-6, "BMI values changed in the round trip")
    return "open WORK > SMOKE_CLASS in the SAS Libraries view to check the data viewer"


@check("SAS.submit PROC SQL view, then sd2df of the view")
def _():
    SAS.submit(
        """
proc sql;
  create view work.smoke_girls as
    select name, age from sashelp.class where sex = 'F';
quit;
"""
    )
    girls = SAS.sd2df("work.smoke_girls")
    expect(len(girls) == 9, f"{len(girls)} rows, expected 9")


@check("SAS.symput / SAS.symget and macro resolution in SAS.submit")
def _():
    SAS.symput("smoke_mv", "hello from python")
    expect(SAS.symget("smoke_mv") == "hello from python", repr(SAS.symget("smoke_mv")))
    SAS.submit("%let smoke_mv2=%upcase(&smoke_mv);")
    expect(SAS.symget("smoke_mv2") == "HELLO FROM PYTHON", repr(SAS.symget("smoke_mv2")))


@check("SAS.sasfnc calls a SAS function")
def _():
    result = SAS.sasfnc("upcase", "smoke")
    expect(str(result).strip() == "SMOKE", repr(result))


# --- 5. Rich output ---------------------------------------------------------


@check("SAS.show(df) renders a table")
def _():
    if not hasattr(SAS, "show"):
        raise Skip("SAS.show needs Viya 2025.03 or later")
    if _class_df is None:
        raise Skip("sd2df failed above")
    SAS.show(_class_df.head(5))


look("Result panel: a 5-row table of sashelp.class from SAS.show(df)")


@check("SAS.show(plt, filetype='png') renders a figure")
def _():
    if not hasattr(SAS, "show"):
        raise Skip("SAS.show needs Viya 2025.03 or later")
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        raise Skip("matplotlib is not installed on the deployment")
    plt.figure()
    plt.plot([1, 2, 3, 4], [3, 1, 4, 2], marker="o")
    plt.title("smoke: SAS.show png")
    SAS.show(plt, filetype="png")
    plt.close("all")


look("Result panel: a line chart titled 'smoke: SAS.show png'")


@check("SAS.submit PROC SGPLOT and PROC PRINT reach the Result panel")
def _():
    # SGPLOT goes first on purpose. On v0.1.4, when it is the last step a
    # script submits, the whole run's printed output is lost
    # (release_smoke_sgplot.py), which would hide every other result here.
    SAS.submit(
        """
title "smoke: proc sgplot";
proc sgplot data=sashelp.class; scatter x=height y=weight / group=sex; run;
title "smoke: proc print";
proc print data=sashelp.class(obs=3); run;
title;
"""
    )


look("Result panel: a 3-row 'smoke: proc print' table and a 'smoke: proc sgplot' scatter image")


@check("Written .png and .html files are captured")
def _():
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        raise Skip("matplotlib is not installed on the deployment")
    fig, ax = plt.subplots()
    ax.bar(["a", "b", "c"], [2, 5, 3])
    ax.set_title("smoke: savefig png")
    fig.savefig(CAPTURE_FILES[0])
    plt.close(fig)
    if _class_df is not None:
        _class_df.head(3).to_html(CAPTURE_FILES[1])
    expect(os.path.exists(CAPTURE_FILES[0]), "savefig wrote nothing")


look("Result panel: 'smoke: savefig png' bar chart and a 3-row pandas HTML table, before SAS.show output")


@check("HTML with a <script> is written for the sanitizer/CSP check")
def _():
    html = (
        "<h3>smoke: sanitizer</h3>"
        '<p id="smoke-target">SAFE: this sentence must be unchanged.</p>'
        "<script>document.getElementById('smoke-target').textContent='SCRIPT RAN - FAIL';</script>"
        '<img src="x" alt="" onerror="document.body.style.background=\'red\'">'
    )
    with open(CAPTURE_FILES[2], "w", encoding="utf-8") as handle:
        handle.write(html)


look("Result panel: 'smoke: sanitizer' reads 'SAFE: ...' and nothing turned red")


# --- 6. CAS token delivery --------------------------------------------------


@check("CAS token file from 'Refresh CAS Token'")
def _():
    # Default name; change this if pythonOnViya.cas.tokenFileref is set.
    token_file = "CASTOKEN"
    if not os.path.exists(token_file):
        raise Skip("run 'Python on Viya: Refresh CAS Token', then Run File again")
    with open(token_file) as handle:
        token = handle.read().strip()
    # Never print the token itself.
    expect(len(token) > 100, f"token file holds only {len(token)} characters")
    expect(not any(ch.isspace() for ch in token), "token contains whitespace")
    try:
        import swat

        return f"swat {swat.__version__} importable; test a live connection per README.md"
    except ImportError:
        return "swat is not installed on the deployment"


# --- 7. Environment ---------------------------------------------------------


@check("Common packages import")
def _():
    found = []
    for name in ("pandas", "numpy", "matplotlib", "swat", "sklearn"):
        try:
            module = __import__(name)
            found.append(f"{name} {getattr(module, '__version__', '?')}")
        except ImportError:
            found.append(f"{name} missing")
    expect(not found[0].endswith("missing"), "pandas is required for SAS.sd2df")
    return "; ".join(found)


# --- Run Selection / interactive window block --------------------------------
# Select the two lines below and use "Run Selection": the counter should
# print 2, then 3, ... after a Run File (the namespace carries over). With
# "Run Selection in Interactive Window" it starts at 1 in that window's session.
_smoke_counter = globals().get("_smoke_counter", 0) + 1
print(f"[INFO] selection counter = {_smoke_counter}", flush=True)

# --- Teardown and summary ----------------------------------------------------

_SMOKE_PY_SENTINEL = True
# Deliberately left set: the next run's OBS check proves the per-job reset.
SAS.submit("options obs=0;")

counts = {status: sum(1 for s, _ in _results if s == status) for status in ("PASS", "FAIL", "SKIP")}
print("\n=== Summary ===", flush=True)
print(f"PASS {counts['PASS']}   FAIL {counts['FAIL']}   SKIP {counts['SKIP']}", flush=True)
for status, name in _results:
    if status != "PASS":
        print(f"  {status}: {name}", flush=True)
print(f"{len(_looks)} LOOK item(s) to confirm in the Result panel / output channel.", flush=True)

if counts["FAIL"]:
    raise AssertionError(f"{counts['FAIL']} smoke check(s) failed; see [FAIL] lines above")

# Release smoke test — printed output after PROC SGPLOT.
#
# Fails on v0.1.4, fixed in 0.1.5 (ADR-0043). When the last step a script
# submits is PROC SGPLOT, SAS types the run's whole printed output as NOTE
# lines, and v0.1.4 dropped them. Output, the traceback and the Problems entry
# all vanished; a failing run showed only "Finished with an error."
#
# 1. Run File. Expect all three "sgplot demo" lines in the output channel and
#    the scatter plot in the Result panel.
# 2. Uncomment the last line and Run File again. Expect the three lines, then
#    a ZeroDivisionError traceback and a Problems entry on that line.
#
# On v0.1.4, step 1 shows only the plot and step 2 only "Finished with an
# error."

# pyright: reportUndefinedVariable=false

print("sgplot demo: before the submit", flush=True)
SAS.submit("proc sgplot data=sashelp.class; scatter x=height y=weight; run;")
print("sgplot demo: after the submit", flush=True)
print("sgplot demo: last line", flush=True)
# 1 / 0

"""The rows `impact` and `path` read out of framework_edge (#1509), in a package.

The issue's own shape: every module imports its neighbours RELATIVELY, the signal and the
task live in their own modules, and each end sits in a different file. Cases 19 and 21 pin
the mechanisms; this one pins the exact rows the two query verbs consume, and the rows
that must NOT exist, because a consumer that reads framework_edge would print them.
"""

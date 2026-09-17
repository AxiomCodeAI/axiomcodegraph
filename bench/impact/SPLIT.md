# The impact co-change split

`split.json` divides the 270 usable Defects4J arena fixes into `dev` (174) and `holdout` (96), stratified by project with
seed 20260916 so both sets see every project. It was made before any of the impact issues (#749 #750 #758 #762 #764) were
worked on, so no instance in either set informed a rule that already exists.

## The rule

Every measurement while a fix is being designed runs on **dev only** (`cochange.py --set dev`). `holdout` is scored **once**,
when the work is finished, and that number is what gets reported. A change motivated by a holdout instance's score has spent
that instance: move it to `dev` in the same commit rather than leaving the list looking intact. This is the discipline
`bench/swe-context/SPLIT.md` arrived at the hard way — its "held-out" figures were 31 % contaminated because five ids lived
in both lists and nothing compared them.

## What it measures

`cochange.py`: one declaration a real fix changed is the seed, the other declarations that same fix changed are the truth.
Seed and truth are both read by `axiomcode changed` from the same patch, so the two sides cannot drift apart. Reported:
co-change recall, the layer and certainty each hit was found at, the miss categories (same file / same package / elsewhere —
the categories #762 is about), a floor on direct-row precision, and the mean answer size, so recall bought with noise shows.

<!--
Every change here follows: issue first, then a pull request that closes it.
If there is no issue yet, open one — the issue is where the measurement that
found the problem lives, and this is where the fix lives.
-->

Fixes #

## What changed

<!-- The mechanism. What the rule now joins on, or what the harness now measures. -->

## Why the goldens moved, or why they did not

<!--
Required whenever test/*/expected changed. A golden diff is a change in resolution
power and has to be readable as one: which edges appeared, which disappeared, and
why each is correct now.

If nothing under test/*/expected changed, say so — "no golden moved" is a real and
useful claim about a rules change.
-->

## Evidence

<!--
Synthetic examples only. Never name the project a defect was found in, quote its
identifiers, or paste its code — not here, not in the issue, not in the commit
message.

Keep the corpus measurement out of the prose too: describe the defect by mechanism,
not by how many links it cost.
-->

## Checklist

- [ ] The three suites pass locally against the parser commit in `.github/parser-ref`
- [ ] Any golden that moved is explained above
- [ ] A fix validated on more than one shape, so this is not overfitting to one case
- [ ] Labels set, including the front end (`java` / `python` / `typescript`)

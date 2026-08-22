# Hooks — keeping A0 ↔ A3 communication alive

`AGENT-PROTOCOL.md` removed the human as a message bus. These hooks remove the
remaining manual step, which is the one that actually breaks: **a channel only
works if someone polls it.** A status board nobody runs and a gate nobody runs
fail exactly the way an unread JSONL file fails.

## Install (once per clone)

```sh
git config core.hooksPath .githooks
export AXIOM_AGENT=A0     # or A3; defaults to A3
```

## What runs

| hook | does |
|---|---|
| `post-commit` | prints your open items from the shared board, then runs the other agent's gate |

## Why advisory rather than blocking

`post-commit` cannot fail a commit, and that is deliberate. A hook that blocks
work gets disabled within a day, and a disabled hook communicates nothing at all.
The gate's own exit code is what a CI step should enforce; this is for making the
other agent's queue and red build *arrive* without being asked for.

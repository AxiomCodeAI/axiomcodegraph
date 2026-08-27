"""TIER 1 -- the call-site inventory, from `dis`. Parses; never imports.

WHAT THIS TIER ANSWERS: did the engine see every call, with the right name and
shape? It does NOT answer which method a name means -- bytecode cannot say.
Disassembling `x.run() + Base().run()` yields two indistinguishable
`LOAD_METHOD run`; Python resolves attributes at runtime, so the compiled form
records no target because there isn't one yet.

That makes this tier the CONSERVATION oracle: a call happened here, spelled this
name, so the engine must have emitted a site for it. A site the engine never
emitted is a silent drop, and no golden diff can see the absence of something
that was never recorded.

Uses `compile()` + recursive `co_consts` walk rather than `python -m dis` output
parsing: same guarantees, structured, no subprocess. Verified property of both --
a file whose top level prints and imports a nonexistent package disassembles
cleanly, while importing it fires the side effect and raises. That is what makes
tiers 1-2 cover 100% of files in a corpus that cannot be imported at all.

CALLEE ATTRIBUTION IS BY STACK SIMULATION, not by "the most recent LOAD".
A call's arguments sit between the callee and the call opcode, so nearest-load is
wrong the moment an argument is itself a name: the callee slot for
`decorate(self.kind, self.value)` comes out as `kind`. The simulation tracks what
pushed each stack slot and reads the callee from the exact slot the opcode
consumes. (Adapted from parser-oracle/python/gates/emit_bytecode_calls.py, which
this harness deliberately reuses rather than reinventing; the addition here is
CALLER attribution and shared normalisation.)
"""

from __future__ import annotations

import dis
import os
import sys
from dataclasses import dataclass, field
from typing import List, Optional

from .normalize import COMPREHENSION_SCOPES, Anchor, Normalizer

# The opcode set is NOT stable across minor versions: 3.11 replaced
# CALL_FUNCTION/CALL_METHOD with PRECALL/CALL, and 3.12 removed PRECALL and
# LOAD_METHOD outright. Running a 3.10 matcher against 3.12 bytecode finds almost
# no calls and reports the shortfall as missing call sites -- a manufactured
# defect. Refuse rather than under-report.
PINNED = (3, 10)
SUPPORTED = {(3, 10), (3, 11), (3, 12), (3, 13)}
VERSION = sys.version_info[:2]

FLAG_PUSHES_TWO = VERSION >= (3, 12)
CALL_OPS = ({'CALL', 'CALL_FUNCTION_EX', 'CALL_KW'} if VERSION >= (3, 11)
            else {'CALL_FUNCTION', 'CALL_METHOD', 'CALL_FUNCTION_KW', 'CALL_FUNCTION_EX'})

LOADS = {
    'LOAD_GLOBAL': 'GLOBAL',
    'LOAD_NAME': 'NAME',
    'LOAD_FAST': 'LOCAL',
    'LOAD_DEREF': 'CLOSURE',
    'LOAD_ATTR': 'ATTRIBUTE',
    'LOAD_METHOD': 'METHOD',
}


def check_interpreter(strict: bool = True) -> None:
    if VERSION not in SUPPORTED:
        raise SystemExit(
            f'callchain-oracle: unsupported interpreter {VERSION[0]}.{VERSION[1]}; '
            f'opcode handling is written for {sorted(SUPPORTED)}')
    if strict and VERSION != PINNED:
        sys.stderr.write(
            f'callchain-oracle: WARNING running {VERSION[0]}.{VERSION[1]}, pinned is '
            f'{PINNED[0]}.{PINNED[1]}. Opcode shapes differ; numbers are not comparable.\n')


@dataclass
class Site:
    """One call the compiler emitted. `callee_name` is a NAME, not a target."""
    file: str
    line: int
    callee_name: str
    via: str                  # GLOBAL | LOCAL | CLOSURE | ATTRIBUTE | METHOD | NAME | UNKNOWN
    op: str
    caller: Anchor            # Rule 3 already applied: comprehensions folded out
    raw_scope: str            # the code object the call literally sat in
    folded: bool = False      # True when Rule 3 moved the caller
    receiver: str = ''        # what the attribute load consumed: self / cls / <super> / a name

    @property
    def implicit(self) -> bool:
        """Rule 10: synthesised by the compiler, not written in the source.

        `class X:` compiles to a call to `__build_class__`, and a comprehension
        compiles to an immediately-invoked code object. Neither is a call the
        author wrote, and neither has a counterpart in the IR, so counting them
        in the conservation denominator invents dropped sites.
        """
        return self.via in ('BUILTIN', 'FUNCTION_OBJECT')

    def key(self) -> str:
        return f'{self.file}:{self.line}:{self.callee_name}:{self.via}'

    def to_json(self) -> dict:
        return {
            'file': self.file, 'line': self.line, 'callee': self.callee_name,
            'via': self.via, 'op': self.op, 'caller': self.caller.key(),
            'rawScope': self.raw_scope, 'foldedFromComprehension': self.folded,
            'receiver': self.receiver, 'implicit': self.implicit,
        }


def _walk(code, out: List[Site], norm: Normalizer, path: str, owner: Anchor) -> None:
    """Simulate the stack of one code object, then recurse into nested ones.

    `owner` is the anchor calls in THIS code object are attributed to, with
    Rule 3 already applied by the caller of this function.
    """
    stack: List[Optional[tuple]] = []
    # starts_line is set only on the FIRST instruction of a line; every later
    # instruction reports None. Carrying it forward is required or nearly every
    # call lands on line `null` and joins to nothing.
    current_line = code.co_firstlineno

    def push(value, n=1):
        for _ in range(n):
            stack.append(value)

    def pop(n=1):
        for _ in range(n):
            if stack:
                stack.pop()

    for ins in dis.get_instructions(code):
        if ins.starts_line is not None:
            current_line = ins.starts_line
        name = ins.opname

        if name == 'LOAD_CONST' and hasattr(ins.argval, 'co_code'):
            # The code object itself, so MAKE_FUNCTION can name what it wraps.
            push((ins.argval.co_name, 'CODE', current_line, ''))
            continue

        if name in LOADS:
            entry = (ins.argval, LOADS[name], current_line, '')
            if FLAG_PUSHES_TWO and name in ('LOAD_ATTR', 'LOAD_GLOBAL'):
                two = bool((ins.arg or 0) & 1)
                if name == 'LOAD_ATTR':
                    recv = stack[-1] if stack else None
                    entry = (ins.argval, LOADS[name], current_line,
                             recv[0] if isinstance(recv, tuple) else '')
                    pop(1)
                    # 3.12 has no LOAD_METHOD; the flag bit is the only thing
                    # that still says "this attribute is being called". Report it
                    # as METHOD so `via` means the same on every version.
                    if two:
                        entry = (ins.argval, 'METHOD', current_line, entry[3])
                push(entry, 2 if two else 1)
                continue
            # LOAD_ATTR pops 1/pushes 1 (net 0); LOAD_METHOD pops 1/pushes 2.
            # Treating them as pure pushes leaves the receiver buried and the
            # callee slot reads an argument name instead.
            if name in ('LOAD_ATTR', 'LOAD_METHOD'):
                # The RECEIVER is the slot this opcode consumes. Recording it is
                # what lets tier 3 resolve `self.m()` and `super().m()` through
                # cls.__mro__ instead of declaring them unknown.
                recv = stack[-1] if stack else None
                entry = (ins.argval, LOADS[name], current_line,
                         recv[0] if isinstance(recv, tuple) else '')
                pop(1)
            push(entry, 2 if name == 'LOAD_METHOD' else 1)
            continue

        # A code object being turned into a function, and the implicit
        # __build_class__ of a `class` statement, both end up CALLED. Naming
        # them keeps those sites out of the UNKNOWN bucket, where they would be
        # indistinguishable from a genuine attribution failure. `class C:` and
        # a decorator application are real call sites and must be conserved.
        if name == 'MAKE_FUNCTION':
            # consumes the code object (+ qualname on <=3.10) and optional
            # defaults/closure flags; pushes one function.
            consumed = 1 + bin(ins.arg or 0).count('1') + (1 if VERSION < (3, 11) else 0)
            made = None
            if len(stack) >= consumed:
                slot = stack[-consumed]
                if isinstance(slot, tuple):
                    made = slot[0]
            pop(min(consumed, len(stack)))
            push(('<function:%s>' % (made or '?'), 'FUNCTION_OBJECT', current_line, ''))
            continue
        if name == 'LOAD_BUILD_CLASS':
            push(('__build_class__', 'BUILTIN', current_line, ''))
            continue

        if name in CALL_OPS:
            argc = ins.arg or 0
            if name == 'CALL':
                consumed = argc + 2
            elif name == 'CALL_KW':
                consumed = argc + 3
            elif name == 'CALL_METHOD':
                consumed = argc + 2
            elif name == 'CALL_FUNCTION':
                consumed = argc + 1
            elif name == 'CALL_FUNCTION_KW':
                consumed = argc + 2          # + the kwnames tuple
            else:                            # CALL_FUNCTION_EX
                consumed = 3 if (argc & 0x01) else 2
            slot = stack[-consumed] if len(stack) >= consumed else None
            pop(min(consumed, len(stack)))
            # The RESULT of a call is itself callable-shaped (`f()()`, and every
            # decorator-with-arguments application). Tagging it CALL_RESULT keeps
            # it out of UNKNOWN, which must mean "attribution failed", not
            # "statically unknowable by construction".
            # `super()` is tagged distinctly: the receiver it produces selects
            # the NEXT class in the caller's MRO, which is a different resolution
            # rule from an ordinary call result and the single highest-value one
            # (7 of the 10 unresolved sites in the engine prototype were super()).
            produced = '<super>' if (slot is not None and slot[0] == 'super') else '<call-result>'
            push((produced, 'SUPER_RESULT' if produced == '<super>' else 'CALL_RESULT',
                  current_line, ''))
            if slot is not None:
                out.append(Site(norm.rel(path), slot[2], slot[0], slot[1], name,
                                owner, code.co_name,
                                receiver=slot[3] if len(slot) > 3 else ''))
            else:
                out.append(Site(norm.rel(path), current_line, '', 'UNKNOWN', name,
                                owner, code.co_name))
            continue

        try:
            effect = dis.stack_effect(ins.opcode, ins.arg)
        except ValueError:
            effect = 0
        if effect < 0:
            pop(min(-effect, len(stack)))
        else:
            push(None, effect)

    for const in code.co_consts:
        if hasattr(const, 'co_code'):
            child_anchor = norm.anchor(path, const.co_firstlineno)
            if const.co_name in COMPREHENSION_SCOPES:
                # Rule 3: the comprehension body is not a method; its calls
                # belong to the lexically containing function.
                child_owner = owner
                folded = True
            else:
                child_owner = child_anchor or owner
                folded = False
            before = len(out)
            _walk(const, out, norm, path, child_owner)
            if folded:
                for s in out[before:]:
                    s.folded = True


def sites_for_file(path: str, norm: Normalizer) -> List[Site]:
    """Every call site in one file. Compiles only; never executes."""
    with open(path, 'rb') as fh:
        src = fh.read()
    try:
        code = compile(src, path, 'exec')
    except SyntaxError:
        return []
    out: List[Site] = []
    # Rule 5: module-level code is a caller, anchored at the synthetic line 0.
    _walk(code, out, norm, path, Anchor(norm.rel(path), 0))
    return out


def sites_for_tree(root: str, norm: Optional[Normalizer] = None) -> List[Site]:
    """Tier 1 over an ARBITRARY PATH -- a file or a directory tree.

    No import required, which is why this tier covers 100% of a corpus while
    tiers 3-4 cover only what can be imported and exercised.
    """
    norm = norm or Normalizer(root if os.path.isdir(root) else os.path.dirname(root))
    if os.path.isfile(root):
        return sites_for_file(root, norm)
    out: List[Site] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('__pycache__', '.git')]
        for fn in sorted(filenames):
            if fn.endswith('.py'):
                out.extend(sites_for_file(os.path.join(dirpath, fn), norm))
    out.sort(key=lambda s: (s.file, s.line, s.callee_name, s.via))
    return out

"""
Every CALL the CPython compiler emitted, with the name it calls.

This is the Python analogue of using JVM bytecode as the call-graph oracle. It is
stronger than the runtime tracer for measuring RECALL: the tracer only sees edges
that actually executed, so unexecuted branches silently shrink the denominator
and flatter the parser. The compiler emits a call instruction for every call in
the source whether it runs or not.

Callee attribution is done by SIMULATING THE STACK rather than by guessing from
nearby instructions. A call's arguments sit between the callee and the call
opcode, so "the most recent LOAD" is wrong as soon as an argument is itself a
name. The simulation tracks what pushed each stack slot, so the callee is read
from the exact slot the opcode consumes.

Compiles only; never imports.
"""
import dis
import json
import os
import sys

LOADS = {
    'LOAD_GLOBAL': 'GLOBAL',
    'LOAD_NAME': 'NAME',
    'LOAD_FAST': 'LOCAL',
    'LOAD_DEREF': 'CLOSURE',
    'LOAD_ATTR': 'ATTRIBUTE',
    'LOAD_METHOD': 'METHOD',
}


def walk_code(code, out, module):
    stack = []
    # starts_line is set only on the FIRST instruction of a line; every later
    # instruction on that line reports None. Carrying it forward is required or
    # nearly every call lands on line "null" and joins to nothing.
    current_line = code.co_firstlineno

    def push(value, n=1):
        for _ in range(n):
            stack.append(value)

    def pop(n=1):
        taken = []
        for _ in range(n):
            taken.append(stack.pop() if stack else None)
        return taken

    for instruction in dis.get_instructions(code):
        if instruction.starts_line is not None:
            current_line = instruction.starts_line
        name = instruction.opname
        if name in LOADS:
            entry = (instruction.argval, LOADS[name], current_line)
            # LOAD_ATTR and LOAD_METHOD CONSUME the object already on the stack.
            #   LOAD_ATTR    pops 1, pushes 1  (net 0)
            #   LOAD_METHOD  pops 1, pushes 2  (net +1)
            # Treating them as pure pushes left the receiver buried on the
            # stack, so the callee slot for `decorate(self.kind, self.value)`
            # came out as `kind` -- and every such miss produced a matching
            # spurious entry, which is why the two counts moved together.
            if name in ('LOAD_ATTR', 'LOAD_METHOD'):
                pop(1)
            push(entry, 2 if name == 'LOAD_METHOD' else 1)
            continue

        if name in ('CALL_FUNCTION', 'CALL_METHOD', 'CALL_FUNCTION_KW', 'CALL_FUNCTION_EX'):
            argc = instruction.arg or 0
            if name == 'CALL_METHOD':
                consumed = argc + 2
            elif name == 'CALL_FUNCTION':
                consumed = argc + 1
            elif name == 'CALL_FUNCTION_KW':
                consumed = argc + 2  # + the kwnames tuple
            else:
                consumed = 3 if (argc & 0x01) else 2
            slot = stack[-consumed] if len(stack) >= consumed else None
            pop(min(consumed, len(stack)))
            push(None)
            if slot is not None:
                out.append(
                    {
                        'module': module,
                        'line': slot[2],
                        'callee': slot[0],
                        'via': slot[1],
                        'op': name,
                    }
                )
            else:
                out.append(
                    {
                        'module': module,
                        'line': current_line,
                        'callee': '',
                        'via': 'UNKNOWN',
                        'op': name,
                    }
                )
            continue

        try:
            effect = dis.stack_effect(instruction.opcode, instruction.arg)
        except ValueError:
            effect = 0
        if effect < 0:
            pop(min(-effect, len(stack)))
        else:
            push(None, effect)

    for const in code.co_consts:
        if hasattr(const, 'co_code'):
            walk_code(const, out, module)


def main():
    root = os.path.abspath(sys.argv[1])
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ('__pycache__', '_holdout')]
        for filename in sorted(filenames):
            if not filename.endswith('.py'):
                continue
            path = os.path.join(dirpath, filename)
            relative = os.path.relpath(path, root)
            try:
                code = compile(open(path, 'rb').read(), path, 'exec')
            except SyntaxError:
                continue
            out = []
            walk_code(code, out, relative)
            for entry in out:
                sys.stdout.write(json.dumps(entry, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()

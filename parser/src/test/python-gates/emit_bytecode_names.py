"""
CPython's OWN name resolution, read out of the compiled bytecode.

This is the closest thing Python has to javac-as-oracle, and it is stronger than
any static analyser including jedi: the compiler has already decided, for every
name, whether it is a local, a global, a closure cell, or an attribute, and it
records that decision in the opcode itself. There is nothing to infer.

  LOAD_FAST    -> a function local
  LOAD_GLOBAL  -> a module global or builtin
  LOAD_DEREF   -> a closure variable (free or cell)
  LOAD_NAME    -> module/class body, resolved at runtime
  LOAD_ATTR    -> an attribute of whatever is on the stack
  LOAD_METHOD  -> an attribute being called, the receiver shape we care about

It adjudicates two things our own gates cannot. First `receiverKind`: whether a
call's receiver really is a local, a global or an attribute is a fact the
compiler states. Second the LOCAL ALIAS case — `_Row = Row` then `_Row(...)`
compiles to LOAD_FAST, proving the callee is a local binding rather than the
global it was copied from, which is precisely the distinction our resolver has
to make.

Compiles only; never imports, so it is safe on any file that parses.
"""
import dis
import json
import sys


def walk_code(code, out):
    """Every LOAD/CALL instruction in this code object and its nested ones."""
    for instruction in dis.get_instructions(code):
        if instruction.opname.startswith(('LOAD_', 'CALL_')):
            out.append(
                {
                    "line": instruction.starts_line,
                    "op": instruction.opname,
                    "arg": str(instruction.argval)
                    if isinstance(instruction.argval, (str, int))
                    else "",
                    "co": code.co_name,
                }
            )
    for constant in code.co_consts:
        if hasattr(constant, "co_code"):
            walk_code(constant, out)


def main(path):
    source = open(path, encoding="utf-8", errors="replace").read()
    try:
        code = compile(source, path, "exec")
    except SyntaxError as error:
        json.dump({"error": str(error), "instructions": []}, sys.stdout)
        return
    out = []
    walk_code(code, out)
    # Carry the last seen line forward: only the first instruction of a line
    # carries starts_line, and every later one on that line reports None.
    current = 0
    for record in out:
        if record["line"] is None:
            record["line"] = current
        else:
            current = record["line"]
    json.dump({"error": "", "instructions": out}, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1])

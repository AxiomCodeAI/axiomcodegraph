"""
Ground truth for py_decorator and py_decorator_argument, from CPython's ast.

Reads paths on stdin, one JSON object per file to stdout.

ast is authoritative here in a way it is not for scopes: a decorator list is a
plain list of expressions attached to a definition, so presence, ORDER, the
dotted name, the call/bare distinction and every argument are all stated
outright rather than inferred.

Application order is the one thing ast does not say and the runtime does:
decorators APPLY bottom-up while they are LISTED top-down, so for

    @a
    @b
    def f(): ...

position is a=0, b=1 but application order is b first. That inversion is
recorded here so the column is checked rather than assumed.
"""
import ast
import json
import sys

FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)
BUILTIN = {'property', 'staticmethod', 'classmethod', 'abstractmethod',
           'cached_property', 'functools.cached_property', 'abc.abstractmethod'}


def dotted(node):
    """The dotted path of a decorator expression, or '' when it is not a name."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f'{base}.{node.attr}' if base else ''
    return ''


def classify(node):
    """The shape of the decorator expression, matching PythonDecoratorKind."""
    if isinstance(node, ast.Name):
        return 'BARE'
    if isinstance(node, ast.Attribute):
        return 'ATTRIBUTE'
    if isinstance(node, ast.Subscript):
        return 'SUBSCRIPT'
    if isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Name):
            return 'CALL'
        if isinstance(func, ast.Attribute):
            return 'ATTRIBUTE_CALL'
        return 'EXPRESSION'
    return 'EXPRESSION'


def literal(node):
    """A value only when ast can state it; '' when it is computed."""
    if isinstance(node, ast.Constant):
        return '' if node.value is None else str(node.value)
    return ''


def arguments(node):
    """Positional then keyword, in the order a reader sees them."""
    out = []
    if not isinstance(node, ast.Call):
        return out
    for index, arg in enumerate(node.args):
        out.append({
            'index': index,
            'name': '',
            'isKeyword': False,
            'dotted': dotted(arg),
            'literal': literal(arg),
            'starred': isinstance(arg, ast.Starred),
        })
    for offset, kw in enumerate(node.keywords):
        # `**kwds` lands in ast's `keywords` with arg=None, but it was not
        # WRITTEN as name=value and has no keyword name -- argumentName is empty
        # for it either way. Calling it a keyword argument would let a consumer
        # look up "the value passed for keyword X" and find a row with no X. The
        # star form stays recoverable from argumentValue, which holds the
        # literal `**kwds` text.
        out.append({
            'index': len(node.args) + offset,
            'name': kw.arg or '',
            'isKeyword': kw.arg is not None,
            'dotted': dotted(kw.value),
            'literal': literal(kw.value),
            'starred': kw.arg is None,
        })
    return out


def run(path):
    src = open(path, 'rb').read()
    tree = ast.parse(src)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, FUNCS + (ast.ClassDef,)):
            continue
        total = len(node.decorator_list)
        for position, dec in enumerate(node.decorator_list):
            inner = dec.func if isinstance(dec, ast.Call) else dec
            name = dotted(inner)
            out.append({
                'ownerName': node.name,
                'context': 'CLASS' if isinstance(node, ast.ClassDef) else 'FUNCTION',
                'position': position,
                # Listed top-down, applied bottom-up.
                'applicationOrder': total - 1 - position,
                'kind': classify(dec),
                'name': name.rsplit('.', 1)[-1] if name else '',
                'dotted': name,
                'argumentCount': (
                    len(dec.args) + len(dec.keywords) if isinstance(dec, ast.Call) else 0
                ),
                'builtin': name in BUILTIN or name.endswith('.setter')
                or name.endswith('.getter') or name.endswith('.deleter'),
                'line': dec.lineno,
                'args': arguments(dec),
            })
    return {'file': path, 'decorators': out}


def main():
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            sys.stdout.write(json.dumps(run(path)) + '\n')
        except Exception as exc:
            sys.stdout.write(json.dumps({'file': path, 'error': f'{type(exc).__name__}: {exc}'}) + '\n')


if __name__ == '__main__':
    main()

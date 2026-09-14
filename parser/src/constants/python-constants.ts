/**
 * Python-specific parser constants.
 */

/**
 * tree-sitter's hard ceiling on a single parse buffer: **32,767 characters**
 * (2^15 - 1), not "about 30KB".
 *
 * Two properties of this limit are easy to get wrong and both matter:
 *
 * 1. **It counts characters, not bytes.** 29k characters of CJK is 62KB of
 *    UTF-8 and parses fine; 33k characters of ASCII is 33KB and does not. A
 *    byte-based guard is wrong in both directions.
 * 2. **The callback's returned chunk carries the same ceiling.** Streaming does
 *    not lift the limit, it only lets you stay under it — so returning a 65536-
 *    byte chunk from the callback throws exactly as a direct parse would.
 *
 * Three of five stdlib packages fail to parse without the callback path, so it
 * is the common path for real code, not an edge case.
 */
import { FILE_EXTENSIONS } from '@/constants/consts';

export const TREE_SITTER_MAX_PARSE_CHARS = 32_767;

/**
 * Character count above which `PythonParser` switches to callback parsing.
 *
 * Deliberately below {@link TREE_SITTER_MAX_PARSE_CHARS} rather than equal to
 * it, mirroring `java-parser.ts`: the margin costs nothing and avoids sitting
 * exactly on a boundary whose accounting is not ours to verify.
 */
export const PYTHON_CALLBACK_PARSE_THRESHOLD = 30_000;

/**
 * Chunk size returned by the streaming parse callback. Well under the ceiling
 * described above, and identical to the Java parser's chunking.
 */
export const PYTHON_PARSE_CHUNK_SIZE = 8_192;

/**
 * The exact interpreter patch this analysis targets. Recorded in every
 * `py_module` row for reproducibility, and paired with invariant #10.
 */
export const PYTHON_TARGET_VERSION = '3.10.4';

/**
 * CPython's synthetic iterator parameter, present in exactly one binding of
 * every comprehension and generator-expression scope on the `PY3_0_11` target.
 *
 * It is a genuine `symtable.Symbol`, so it is emitted as a real `py_binding`
 * row and asserted positively — never whitelisted, because a whitelist also
 * passes when the binding is missing.
 */
export const PYTHON_SYNTHETIC_ITERATOR = '.0';

/** symtable's own name for the module scope. */
/**
 * The base name of a package's initialiser, without extension.
 *
 * A module is never NAMED for this file: `pkg/__init__.py` is the module `pkg`,
 * not `pkg.__init__`. Both are checked when asking whether a directory is a
 * package, because a stub-only distribution ships `__init__.pyi` and no `.py`
 * at all. Treating only `.py` as the marker makes a stub package invisible, and
 * every module under it is then named as though it sat at the top level, so
 * `collections/abc.pyi` and `abc.pyi` collapse onto the same name.
 */
export const PYTHON_PACKAGE_INIT_STEM = '__init__';

/** Every file name that marks a directory as a regular package. */
export const PYTHON_PACKAGE_INIT_FILENAMES: readonly string[] = [
  `${PYTHON_PACKAGE_INIT_STEM}${FILE_EXTENSIONS.PYTHON}`,
  `${PYTHON_PACKAGE_INIT_STEM}${FILE_EXTENSIONS.PYTHON_STUB}`,
];

/**
 * Whether a file name is a package initialiser, in either dialect of the tree.
 *
 * The extension decides nothing about a module's identity: a stub tree must be
 * named exactly as the source tree in the same position would be, or a library
 * parsed separately cannot be linked to by name.
 */
export function isPythonPackageInitFileName(fileName: string): boolean {
  return PYTHON_PACKAGE_INIT_FILENAMES.includes(fileName);
}

export const PYTHON_MODULE_SCOPE_NAME = 'top';

/** The `<locals>` marker CPython inserts into `__qualname__` inside functions. */
export const PYTHON_LOCALS_MARKER = '<locals>';

/** Synthetic method minted per module so module-level code always has an owner. */
export const PYTHON_MODULE_INITIALIZER_NAME = '<module>';

/** Synthetic method minted per class body, the `<clinit>` analogue. */
export const PYTHON_CLASS_INITIALIZER_NAME = '<classbody>';

/** symtable's name for every lambda scope. Two on one line are distinguished only by column. */
export const PYTHON_LAMBDA_SCOPE_NAME = 'lambda';

/**
 * CPython's `__qualname__` for a lambda, and therefore `py_method.name`.
 *
 * Deliberately different from {@link PYTHON_LAMBDA_SCOPE_NAME}: symtable calls
 * the scope `lambda`, while the function object's qualname is `<lambda>`. Each
 * column follows its own source of truth rather than being forced to agree.
 */
export const PYTHON_LAMBDA_METHOD_NAME = '<lambda>';

/** CSV file names for the Python fact tables. */
export const PYTHON_CSV_FILES = {
  MODULES: 'all-python-modules.csv',
  SCOPES: 'all-python-scopes.csv',
  BINDINGS: 'all-python-bindings.csv',
  TYPES: 'all-python-types.csv',
  TYPE_BASES: 'all-python-type-bases.csv',
  METHODS: 'all-python-methods.csv',
  METHOD_PARAMETERS: 'all-python-method-parameters.csv',
  IMPORTS: 'all-python-imports.csv',
  EXPRESSIONS: 'all-python-expressions.csv',
  CALL_SITES: 'all-python-call-sites.csv',
  TYPE_REFERENCES: 'all-python-type-references.csv',
  FIELDS: 'all-python-fields.csv',
  FIELD_POSITIONS: 'all-python-field-positions.csv',
  BLOCKS: 'all-python-blocks.csv',
  COMMENTS: 'all-python-comments.csv',
  PARSE_GAPS: 'all-python-parse-gaps.csv',
  TYPE_PARAMETERS: 'all-python-type-parameters.csv',
  DECORATORS: 'all-python-decorators.csv',
  DECORATOR_ARGUMENTS: 'all-python-decorator-arguments.csv',
  SKIPPED_FILES: 'skipped-python-files.csv',
} as const;

/**
 * Builtin scalar type names, for classifying an inferred type without resolving
 * it (`py_expression.inferredTypeKind`, schema v7 §2.15 c34).
 *
 * These are the names that cannot be a user class, because a module cannot
 * shadow them in a way the parser could see without resolution.
 */
export const PYTHON_BUILTIN_SCALAR_TYPES: ReadonlySet<string> = new Set([
  'int',
  'float',
  'complex',
  'bool',
  'str',
  'bytes',
  'bytearray',
  'memoryview',
]);

/** Builtin container type names. */
export const PYTHON_BUILTIN_COLLECTION_TYPES: ReadonlySet<string> = new Set([
  'list',
  'dict',
  'set',
  'frozenset',
  'tuple',
  'List',
  'Dict',
  'Set',
  'FrozenSet',
  'Tuple',
  'Sequence',
  'Mapping',
  'MutableMapping',
  'Iterable',
  'Iterator',
]);

/**
 * The public method set of each builtin container and string type, plus the
 * `collections` types that behave like them.
 *
 * Generated from CPython 3.10.4 itself (`dir(list)` and friends), which is why it
 * is ground truth rather than a hand-written guess. It exists so an attribute
 * whose type is known to be a builtin can resolve a call ON that attribute:
 * `self._buf = bytearray()` followed by `self._buf.extend(d)` reaches
 * `bytearray.extend`.
 *
 * The membership test is the point. Without it, `self._items = []` followed by
 * `self._items.frobnicate()` would be reported as a builtin call — wrong, and
 * worse, it would HIDE a real bug in the analysed code. With it, an unknown name
 * on a known type stays `UNRESOLVED`, which is the honest answer.
 */
export const PYTHON_BUILTIN_TYPE_METHODS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['list', new Set(['append', 'clear', 'copy', 'count', 'extend', 'index', 'insert', 'pop', 'remove', 'reverse', 'sort'])],
  ['dict', new Set(['clear', 'copy', 'fromkeys', 'get', 'items', 'keys', 'pop', 'popitem', 'setdefault', 'update', 'values'])],
  ['set', new Set(['add', 'clear', 'copy', 'difference', 'difference_update', 'discard', 'intersection', 'intersection_update', 'isdisjoint', 'issubset', 'issuperset', 'pop', 'remove', 'symmetric_difference', 'symmetric_difference_update', 'union', 'update'])],
  ['frozenset', new Set(['copy', 'difference', 'intersection', 'isdisjoint', 'issubset', 'issuperset', 'symmetric_difference', 'union'])],
  ['tuple', new Set(['count', 'index'])],
  ['str', new Set(['capitalize', 'casefold', 'center', 'count', 'encode', 'endswith', 'expandtabs', 'find', 'format', 'format_map', 'index', 'isalnum', 'isalpha', 'isascii', 'isdecimal', 'isdigit', 'isidentifier', 'islower', 'isnumeric', 'isprintable', 'isspace', 'istitle', 'isupper', 'join', 'ljust', 'lower', 'lstrip', 'maketrans', 'partition', 'removeprefix', 'removesuffix', 'replace', 'rfind', 'rindex', 'rjust', 'rpartition', 'rsplit', 'rstrip', 'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title', 'translate', 'upper', 'zfill'])],
  ['bytes', new Set(['capitalize', 'center', 'count', 'decode', 'endswith', 'expandtabs', 'find', 'fromhex', 'hex', 'index', 'isalnum', 'isalpha', 'isascii', 'isdigit', 'islower', 'isspace', 'istitle', 'isupper', 'join', 'ljust', 'lower', 'lstrip', 'maketrans', 'partition', 'removeprefix', 'removesuffix', 'replace', 'rfind', 'rindex', 'rjust', 'rpartition', 'rsplit', 'rstrip', 'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title', 'translate', 'upper', 'zfill'])],
  ['bytearray', new Set(['append', 'capitalize', 'center', 'clear', 'copy', 'count', 'decode', 'endswith', 'expandtabs', 'extend', 'find', 'fromhex', 'hex', 'index', 'insert', 'isalnum', 'isalpha', 'isascii', 'isdigit', 'islower', 'isspace', 'istitle', 'isupper', 'join', 'ljust', 'lower', 'lstrip', 'maketrans', 'partition', 'pop', 'remove', 'removeprefix', 'removesuffix', 'replace', 'reverse', 'rfind', 'rindex', 'rjust', 'rpartition', 'rsplit', 'rstrip', 'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title', 'translate', 'upper', 'zfill'])],
  ['deque', new Set(['append', 'appendleft', 'clear', 'copy', 'count', 'extend', 'extendleft', 'index', 'insert', 'maxlen', 'pop', 'popleft', 'remove', 'reverse', 'rotate'])],
  ['defaultdict', new Set(['clear', 'copy', 'default_factory', 'fromkeys', 'get', 'items', 'keys', 'pop', 'popitem', 'setdefault', 'update', 'values'])],
  ['OrderedDict', new Set(['clear', 'copy', 'fromkeys', 'get', 'items', 'keys', 'move_to_end', 'pop', 'popitem', 'setdefault', 'update', 'values'])],
  ['Counter', new Set(['clear', 'copy', 'elements', 'fromkeys', 'get', 'items', 'keys', 'most_common', 'pop', 'popitem', 'setdefault', 'subtract', 'total', 'update', 'values'])],
]);

/**
 * Every name in CPython's `builtins` module, generated from the pinned 3.10
 * interpreter rather than hand-listed.
 *
 * Used to separate a reference to a builtin from a reference to a module-level
 * global. CPython's own symtable cannot make that distinction, because
 * LOAD_GLOBAL checks module globals first and builtins second and the decision
 * is a runtime one, so both come back as "global". That is why py_binding
 * carries its own BUILTIN kind: without it a consumer cannot tell `len` from a
 * global someone defined, and the two need different handling when resolving a
 * call.
 */
export const PYTHON_BUILTIN_NAMES: ReadonlySet<string> = new Set([
  'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException', 'BlockingIOError',
  'BrokenPipeError', 'BufferError', 'BytesWarning', 'ChildProcessError',
  'ConnectionAbortedError', 'ConnectionError', 'ConnectionRefusedError',
  'ConnectionResetError', 'DeprecationWarning', 'EOFError', 'Ellipsis', 'EncodingWarning',
  'EnvironmentError', 'Exception', 'False', 'FileExistsError', 'FileNotFoundError',
  'FloatingPointError', 'FutureWarning', 'GeneratorExit', 'IOError', 'ImportError',
  'ImportWarning', 'IndentationError', 'IndexError', 'InterruptedError', 'IsADirectoryError',
  'KeyError', 'KeyboardInterrupt', 'LookupError', 'MemoryError', 'ModuleNotFoundError',
  'NameError', 'None', 'NotADirectoryError', 'NotImplemented', 'NotImplementedError',
  'OSError', 'OverflowError', 'PendingDeprecationWarning', 'PermissionError',
  'ProcessLookupError', 'RecursionError', 'ReferenceError', 'ResourceWarning', 'RuntimeError',
  'RuntimeWarning', 'StopAsyncIteration', 'StopIteration', 'SyntaxError', 'SyntaxWarning',
  'SystemError', 'SystemExit', 'TabError', 'TimeoutError', 'True', 'TypeError',
  'UnboundLocalError', 'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeError',
  'UnicodeTranslateError', 'UnicodeWarning', 'UserWarning', 'ValueError', 'Warning',
  'ZeroDivisionError', 'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool',
  'breakpoint', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
  'copyright', 'credits', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec',
  'exit', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash',
  'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'license',
  'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord',
  'pow', 'print', 'property', 'quit', 'range', 'repr', 'reversed', 'round', 'set', 'setattr',
  'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
]);

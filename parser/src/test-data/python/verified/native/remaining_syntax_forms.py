"""Closes the remaining Gate-3 node-type gap that isn't `match`: assert,
break/continue, elif chains, implicit string concatenation, f-string
interpolation forms (literal `{{`/`}}` escapes, a nested dynamic format
spec, and a plain format spec), backslash line continuation, `not`,
a plain set display, slice forms, and a typed parameter with a default
value. Each construct was confirmed against `ast.parse` before staging;
none of this is exotic, it is simply syntax the mined corpus's six
projects happened not to phrase this way often enough to be sampled.
"""


def demo(items, width, value):
    total = 0
    for item in items:
        if item is None:
            # continue_statement
            continue
        if item < 0:
            # break_statement
            break
        total += item

    # assert_statement, with and without a message expression
    assert total >= 0, f"total went negative: {total}"
    assert isinstance(items, list)

    # concatenated_string: two adjacent string literals, one expression
    label = "part-one" "part-two"

    # escape_interpolation: a literal `{{`/`}}` pair inside an f-string,
    # not a real interpolation, immediately followed by a real one
    literal_braces = f"{{not-a-field}} then {value}"

    # interpolation whose format_specifier itself contains a NESTED
    # interpolation (aliased to format_expression only in that position)
    formatted = f"{value:{width}.2f}"
    nested_spec = f"{value:>{width}}"

    # a plain (non-nested) format_specifier, contrasted with the two above
    plain_spec = f"{value:.2f}"

    # not_operator
    tag = not (total == 0)

    # a plain set display — distinct from set/dict comprehensions, which
    # are already covered elsewhere in this corpus
    bag = {1, 2, 3, total}

    # slice, in each of its optional-start/stop/step combinations
    head = items[0:2]
    every_other = items[::2]
    tail = items[1:]
    all_but_last = items[:-1]
    reversed_view = items[::-1]

    # elif_clause chain (more than one elif, plus a final else)
    if total > 100:
        category = "large"
    elif total > 10:
        category = "medium"
    elif total > 0:
        category = "small"
    else:
        category = "empty"

    # line_continuation: a backslash-newline joining one logical line
    combined = 1 + \
        2 + \
        3

    return (
        label,
        literal_braces,
        formatted,
        nested_spec,
        plain_spec,
        tag,
        bag,
        (head, every_other, tail, all_but_last, reversed_view),
        category,
        combined,
    )


def with_typed_default(count: int = 0, name: str = "anon", ratio: float = 1.0):
    # typed_default_parameter: annotation AND a default value on the same
    # parameter, for every parameter in the signature
    return count, name, ratio

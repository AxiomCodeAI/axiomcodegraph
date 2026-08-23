"""Suite forms — every block kind, including the else-clauses people forget."""


class Guard:
    def check(self, flag: bool) -> int:
        if flag:
            return 1
        elif not flag:
            return 2
        else:
            return 3


def loops(items):
    total = 0
    for item in items:
        total += 1
    else:
        total += 10

    while total < 20:
        total += 1
    else:
        total += 100
    return total


def exceptions() -> int:
    try:
        value = 1
    except ValueError:
        value = 2
    except (TypeError, KeyError) as exc:
        value = 3
    else:
        value += 1
    finally:
        value += 1
    return value


def context_managers(a, b) -> int:
    with a as first:
        with b as second:
            return 1


def matching(command) -> int:
    match command:
        case 0:
            return 0
        case [x, y]:
            return 1
        case {"k": v}:
            return 2
        case Guard() if command:
            return 3
        case _:
            return 4


def exercise() -> int:
    return Guard().check(True) + exceptions() + matching(0)

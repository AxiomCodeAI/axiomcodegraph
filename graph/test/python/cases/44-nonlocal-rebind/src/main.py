# A closure cell rebound from a nested scope through `nonlocal` is written twice, so the
# call through it must not commit to the first write alone (#381).


def first() -> str:
    return "first"


def second() -> str:
    return "second"


def nonlocal_rebind() -> str:
    fn = first

    def swap() -> None:
        nonlocal fn
        fn = second

    swap()
    return fn()


def nonlocal_read_only() -> str:
    # A nested scope that only READS the cell through `nonlocal` is not a write; the call
    # still has exactly one value and stays a committed edge.
    fn = first

    def peek() -> str:
        nonlocal fn
        return fn.__name__

    peek()
    return fn()


def unrelated_nested_name() -> str:
    # A nested scope that assigns its OWN local of the same name does not touch the cell.
    fn = first

    def shadow() -> None:
        fn = second
        fn()

    shadow()
    return fn()


def main() -> None:
    nonlocal_rebind()
    nonlocal_read_only()
    unrelated_nested_name()


if __name__ == "__main__":
    main()

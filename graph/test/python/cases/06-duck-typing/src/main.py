"""06 -- duck typing. Two unrelated classes, one method name, called through a
parameter.

INTENT: to PIN THE ANSWER SHAPE, not to demand a resolution. `render(thing)`
below has no annotation and no shared base; nothing in the program text says
which `draw` runs. Per the fact schema 68.2% of Python parameters carry no
annotation, so this is the common case, not a corner.

There are exactly two defensible answers -- a dispatch set over both `draw`
definitions, or a declared unknown -- and the point of the case is that the
engine must pick one and record it. What is NOT acceptable is dropping the site,
or naming one of the two without a soundness argument for excluding the other.

`only_circle` is the control: one client definition of that name, so the dispatch
set is a singleton for a structural reason rather than by guesswork.
"""


class Circle:
    def draw(self):
        return "circle"

    def only_circle(self):
        return "just-circle"


class Square:
    # No relationship to Circle whatsoever. Same method name.
    def draw(self):
        return "square"


def render(thing):
    # Untyped parameter: the receiver's type is not determined by the text.
    return thing.draw()


def render_unique(thing):
    # Same shape, but only one client class defines this name.
    return thing.only_circle()


def main():
    print(render(Circle()))
    print(render(Square()))
    print(render_unique(Circle()))


if __name__ == "__main__":
    main()

# `new` on a class with no constructor anywhere in its chain

`new Bag()` on a class that declares no constructor resolved to nothing, while every
method call on the instance resolved: the compiler reports a signature with no
declaration, so no row in the IR could be the target. The parser now synthesises a
`DEFAULT_CONSTRUCTOR` row for a class that declares none and extends nothing (as the
Java front end does), and the oracle labels the same class. `Explicit` is the control;
`Named` extends a class WITH a constructor and must run that one, not a synthetic of
its own; `Tagged` extends a class without one and reaches the root's synthetic row
through the `extends` walk. Every `new` must be a `known_edge` to a `<new>`.

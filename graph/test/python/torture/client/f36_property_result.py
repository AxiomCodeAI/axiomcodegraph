"""FAMILY 36 — CALLING SOMETHING ON WHAT A `@property` RETURNS (issue #286).

`attribute-lookup.dl` already argues that `obj.x` on a `@property` IS a method call and
`call_chain.dl` emits the PROPERTY_READ edge for it. What nothing did was give the
ATTRIBUTE EXPRESSION the getter's type, so the edge was emitted and its result was
untyped, and anything called on that result was `ambiguous_unknown` with reason
`no_rule`.

The three rules that type a call result -- `call_returns_type` (a) declared `-> X`,
(b) return-of-parameter, (c2) the return expression's own type -- are all keyed on
`expr_call_candidate(site, m)`, and a property read HAS NO CALL SITE. So none of them
could reach these, and the field clauses could not either, because a property is not a
field. Measured across three open-source projects, 995 / 90 / 227 `no_rule` sites had a
property-read receiver; on the first that was 60.2% of its entire `no_rule` residual.

The shape is the framework-accessor idiom, and `app.router.add_get(...)` is its most
common spelling in the wild:

    class Application:
        @property
        def router(self) -> UrlDispatcher: return self._router

WHY EACH CASE IS HERE. The getter can be typed two ways and the difference matters --
`annotated` reads the `-> X`, `inferred` has no annotation at all and is typed from the
expression it returns, which is the majority form in real code. `overridden` is the
widening check: a declared return type is a DECLARED type, not an exact one, so a
subclass override must stay in the set. `chained` is two property hops, which is what
proves the rule composes rather than working one level deep. `container` is the element
path, which lives in a different relation (`element_type_of`) and would otherwise be
untested. The two `lib_` cases cross the boundary in both directions, and the boundary is
where a separate relation (`expr_lib_type`) takes over.

`cached` is the `@functools.cached_property` spelling of `annotated`, pinned separately
because it reaches the same rule only through the parser's `methodKind` classification
(AxiomCodeAI/parser#147) rather than through anything the engine controls. Its getter is
underscored for a reason recorded at the getter itself: tier 4 cannot observe a cached
getter's invocation at all.

`builtin_annotated`, `builtin_container` and `builtin_inferred` cover the builtin
dimension -- `expr_builtin_type` and `element_builtin_iterated_of`,
whose own file warns that it was left behind when `expr_type` and the element types were
generalised past `self.` -- so a property read reaching it is checked here rather than
assumed.

`plain_field` is the control: identical call shape through an ordinary annotated field,
which already worked. If it ever fails alongside the others, the fault is not here.
"""
import functools
from typing import List

from tlib import Config, Depot, Factory


class Dispatcher:
    def add_get(self, path: str) -> str:
        return "GET " + path


class SubDispatcher(Dispatcher):
    def add_get(self, path: str) -> str:
        return "sub GET " + path


class Item:
    def run(self) -> str:
        return "item"


class Application:
    def __init__(self) -> None:
        self._router = Dispatcher()
        self._items = [Item(), Item()]
        self._name = "app"
        self._tags = {"a": 1}
        self._labels = ["x", "y"]
        self.direct: Dispatcher = Dispatcher()

    @property
    def router(self) -> Dispatcher:
        # ANNOTATED getter: typed from `-> Dispatcher`.
        return self._router

    @property
    def inferred(self):
        # NO annotation: typed from the expression it returns. The majority form.
        return self._router

    @property
    def items(self) -> List[Item]:
        # A CONTAINER return, so the payload is an element type, not a type.
        return self._items

    @property
    def name(self) -> str:
        # A BUILTIN return. This lives in expr_builtin_type, a THIRD relation, and the
        # file that owns it carries the warning this case exists to honour: expr_type and
        # the element types were both generalised past `self.` and expr_builtin_type was
        # left behind by both times.
        return self._name

    @functools.cached_property
    def _cached_router(self) -> Dispatcher:
        # A CACHED property. functools.cached_property is the same construct with a memo --
        # a descriptor whose __get__ runs the body once -- and the parser classifies it
        # PROPERTY_GETTER with methodModifier=CACHED since AxiomCodeAI/parser#147. Before
        # that it was an INSTANCE_METHOD nobody calls, so it was outside this rule
        # entirely: 389 occurrences across the five projects measured, 300 of them in one.
        #
        # UNDERSCORED DELIBERATELY, and the reason is a fact about the ground truth rather
        # than about naming. `property.__get__` is C, so a plain getter's frame has the
        # READING function as its Python parent and tier 4 records a client -> client edge
        # for it. `functools.cached_property.__get__` is PYTHON, so this body's parent
        # frame is in functools and tier 4's client-caller edge set contains no edge for it
        # at all -- verified in gt-tier4.json, which has `router` and `inferred` and
        # nothing whose callee is this. The harness's "every fixture function must run"
        # assertion would therefore demand an edge the trace structurally cannot produce.
        #
        # The consequence is one accepted `extra` in the scorecard: the engine emits the
        # PROPERTY_READ to this getter, correctly, and the oracle has no row to agree with.
        # The OBSERVABLE half of the case is `add_get` on the result, which tier 4 does see
        # and which is what the rule is actually being tested for.
        return self._router

    @property
    def labels(self) -> List[str]:
        # A container of BUILTINS, which is a FIFTH relation again
        # (element_builtin_iterated_of): iterating this must bind a str, not nothing.
        return self._labels

    @property
    def tags(self):
        # A builtin return with NO annotation -- typed from the dict it hands back. One
        # project in the measured set has 534 property getters and annotates none of them.
        return self._tags


class SubApplication(Application):
    @property
    def router(self) -> SubDispatcher:
        # The override the widening has to keep: a declared return type is declared, not
        # exact, so reading `.router` off an Application must admit this one too.
        return SubDispatcher()


class Outer:
    def __init__(self) -> None:
        self._app = Application()

    @property
    def app(self) -> Application:
        return self._app


def annotated() -> str:
    return Application().router.add_get("/a")


def inferred() -> str:
    return Application().inferred.add_get("/b")


def overridden() -> str:
    return SubApplication().router.add_get("/c")


def chained() -> str:
    # TWO property hops before the call: Outer.app -> Application.router -> add_get.
    return Outer().app.router.add_get("/d")


def container() -> str:
    parts = []
    for it in Application().items:
        parts.append(it.run())
    return "".join(parts)


def cached() -> str:
    return Application()._cached_router.add_get("/f")


def builtin_annotated() -> str:
    # `-> str`, then a str method on the result.
    return Application().name.upper()


def builtin_container() -> str:
    parts = []
    for label in Application().labels:
        parts.append(label.upper())
    return "".join(parts)


def builtin_inferred() -> str:
    # no annotation, then a dict method on the result.
    return str(sorted(Application().tags.keys()))


def lib_property_returns_lib_class() -> str:
    # A LIBRARY property returning a LIBRARY class, then a method on the result.
    return Depot().factory.build()


def lib_property_returns_lib_container() -> str:
    parts = []
    for f in Depot().factories:
        parts.append(f.build())
    return "".join(parts)


def client_property_returns_lib_class() -> str:
    return Holder().cfg.tag


class Holder:
    def __init__(self) -> None:
        self._cfg = Config("held")

    @property
    def cfg(self) -> Config:
        # A CLIENT getter whose declared return type is a LIBRARY class.
        return self._cfg


def plain_field() -> str:
    # CONTROL: the same call shape through an ordinary annotated field.
    return Application().direct.add_get("/e")


def drive() -> str:
    return " ".join([
        annotated(),
        inferred(),
        overridden(),
        chained(),
        container(),
        cached(),
        builtin_annotated(),
        builtin_container(),
        builtin_inferred(),
        lib_property_returns_lib_class(),
        lib_property_returns_lib_container(),
        client_property_returns_lib_class(),
        plain_field(),
    ])

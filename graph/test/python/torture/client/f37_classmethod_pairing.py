"""FAMILY 37 — a REGISTRY HELPER that takes a class, and two hierarchies whose
classmethods share a name (issue #289).

f14 already covers a class object travelling through every carrier, but every case there
calls the same classmethod on classes from ONE hierarchy, so a cross product and a
pairing are indistinguishable. This family is the case that separates them.

`cls_bound_type` clause (a) reads the class objects a call site's receiver can hold and
the classmethods the site can resolve to, and — before #289 — joined neither to the
other. So at the helper below, where `objcls` holds a different class at every call, EVERY
candidate `from_crawler` was credited with EVERY class in the set, including classes from
the other hierarchy entirely. `cls` inside each body then stood for all three, and the
`cls()` construction fanned accordingly.

MEASURED ON A CORPUS PROJECT before the fix: one `from_crawler` collected 123 bound
classes where 11 inherit from its owner, the `cls(...)` site inside it exceeded the
dispatch cap of 20, and `expr_resolves_to_method` therefore dropped ALL of its concrete
constructors — the site kept only `builtin:object.__init__`. So the cross product does not
merely widen, it can take a site past the cap and lose every real answer.

WHY BOTH HIERARCHIES DEFINE `label`: a wrong bound class is only OBSERVABLE if the body
goes on to call something that class also defines. Without that, `Scheduler` being in
`Spider.from_crawler`'s set contributes no edge and the fixture would pass either way.

`explicit_class_object` and `through_an_instance` are the controls — the two spellings that
were never ambiguous — so a regression in the pairing join is distinguishable from one in
clause (a)'s reach.
"""


class Crawler:
    def settings(self) -> str:
        return "settings"


class Spider:
    @classmethod
    def from_crawler(cls, crawler: Crawler) -> str:
        # `cls` must stand for Spider and SubSpider ONLY. Scheduler reaches its OWN
        # from_crawler, never this one.
        return cls().label()

    def label(self) -> str:
        return "spider"


class SubSpider(Spider):
    def label(self) -> str:
        return "sub"


class Scheduler:
    """An unrelated hierarchy whose classmethod has the SAME NAME."""

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> str:
        return cls().label()

    def label(self) -> str:
        return "scheduler"


def build(objcls, crawler: Crawler) -> str:
    # THE HELPER. `objcls` is an ordinary parameter holding a class, so its type-class-object
    # set is the union of everything handed in below — and the call resolves to both
    # from_crawler bodies. This is the site the cross product happens at.
    return objcls.from_crawler(crawler)


def registry_helper() -> str:
    c = Crawler()
    c.settings()
    return " ".join([build(Spider, c), build(SubSpider, c), build(Scheduler, c)])


def explicit_class_object() -> str:
    # CONTROL: the receiver names one class, so pairing and crossing agree.
    return Spider.from_crawler(Crawler())


def through_an_instance() -> str:
    # CONTROL: a classmethod reached through an instance — clause (b), untouched here.
    return Scheduler().from_crawler(Crawler())


def drive() -> str:
    return " / ".join([registry_helper(), explicit_class_object(), through_an_instance()])

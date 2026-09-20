"""Dependency injection: a provider named in a DEFAULT VALUE that the framework calls.

A handler declares `svc: Service = Depends(get_service)`. The framework inspects
the signature, CALLS `get_service`, and passes the result in. `Depends(get_service)`
passes the function as a value; it never calls it. So the provider has zero callers,
and a provider that itself declares a dependency forms a chain no rule follows.

THE NEGATIVE HALF IS THE POINT. The argument to the marker must be a REFERENCE to
a def. `Depends(get_service())` calls it eagerly -- an ordinary call, already a
known edge, and not an injection. A default value that is not a marker is not one
either, and a marker with no argument names no provider at all.
"""


def Depends(fn=None):
    return fn


def Security(fn=None, scopes=None):
    """A second marker spelling: the rule is about the shape, not one name."""
    return fn


class _App:
    def get(self, path):
        return lambda f: f

    def post(self, path):
        return lambda f: f


app = _App()


# ── providers: the framework calls these, nothing here does ─────────────────
def get_settings():
    return {"dsn": "sqlite://"}


def get_service(settings=Depends(get_settings)):
    """A provider that itself declares one. The chain has to carry through."""
    return Service(settings)


def get_user(token=Depends(get_settings)):
    return token


class Service:
    def __init__(self, settings):
        self.settings = settings

    def total(self):
        return _compute(self.settings)


def _compute(settings):
    """Reached only through a provider, then a handler: the impact test."""
    return settings


# ── handlers ────────────────────────────────────────────────────────────────
@app.get("/items/{key}")
def read_item(key, svc=Depends(get_service)):
    return svc.total()


@app.post("/admin")
def admin(user=Security(get_user, scopes=["admin"])):
    return user


# ── NOT injection, and each would be if a condition were dropped ────────────
def eager(settings=Depends(get_settings())):
    """The provider is CALLED here. That is an ordinary call site, not a hop."""
    return settings


def plain_default(limit=50):
    """A default that is not a marker injects nothing."""
    return limit


def empty_marker(x=Depends()):
    """A marker naming no provider. Nothing to wire."""
    return x

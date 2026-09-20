"""Hooks a data layer calls on your behalf.

An ORM lets a function be attached to a lifecycle moment -- `@listens_for(User,
"before_insert")` -- and a model lets a field validator be declared the same way.
The library calls them; no client call site does. So a validator looks dead, and a
change to one looks like it affects nothing.

THE NEGATIVE HALF IS THE POINT. `validates` and `listens_for` are ordinary names.
A hook is recognised only from a decorator whose dotted path carries the library's
receiver and which names its target, so a project's own `@validates` helper, and a
bare call to a function of the same name, stay as they read.
"""


class _Event:
    def listens_for(self, target, identifier, **kw):
        return lambda f: f


event = _Event()


def validates(*fields):
    return lambda f: f


def field_validator(*fields, **kw):
    return lambda f: f


def model_validator(**kw):
    return lambda f: f


class User:
    email = None
    name = None


# ── hooks: the library calls these, nothing here does ───────────────────────
@event.listens_for(User, "before_insert")
def stamp_created(mapper, connection, target):
    return _normalise(target)


@event.listens_for(User, "after_update")
def audit_change(mapper, connection, target):
    return _normalise(target)


class UserModel:
    @validates("email")
    def check_email(self, key, value):
        return _normalise(value)

    @field_validator("name")
    def check_name(cls, value):
        return _normalise(value)

    @model_validator(mode="after")
    def check_all(self):
        return _normalise(self)


def _normalise(value):
    """Reached only through a hook: the test that the hop carries impact."""
    return value


# ── NOT hooks, and each would be if a condition were dropped ────────────────
def local_validates(f):
    """A project's own decorator that happens to be spelled the same."""
    return f


@local_validates
def not_a_hook(value):
    return value


def calls_validates_directly(value):
    """An ordinary call to a function named `validates`. Not a registration."""
    return validates(value)

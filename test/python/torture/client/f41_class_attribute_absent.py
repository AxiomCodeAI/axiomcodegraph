"""FAMILY 41 — an attribute read on a CLASS OBJECT that the engine cannot see.

`expr_type_untypable` clause (4b) names `a.b.c()` where `a` is typed and `b` is not a
member of its type. It joins `expr_type`, which is an INSTANCE type, so a receiver whose
object is a CLASS matched no clause at all and the site landed in `no_rule` — the bucket
that means "no diagnosis", which #116 exists to shrink.

MEASURED on the largest project in the corpus: 14,116 of its 19,046 `no_rule` sites are
this, and they are overwhelmingly one idiom —

    Number.objects.filter(...)        User.objects.count()
    Restaurant.objects.create(...)    Publisher.objects.annotate(...)

— a manager installed on every model class by a metaclass. The engine cannot see the
attribute, which is the right answer; what it could not do was say so.

THIS FAMILY ASSERTS A DIAGNOSIS, NOT A RESOLUTION, and that is the point of it. Nothing
here becomes a known_edge: a metaclass-installed attribute is genuinely out of reach and
answering would be fabricating. What changes is that the site names its blind spot, so the
residual can be counted and worked rather than shrugged at.

`metaclass_installed` is the idiom in miniature. `plainly_absent` is the same shape with no
metaclass at all, to show the clause keys on the object being a CLASS rather than on any
metaclass machinery. `on_an_instance` is the control — the instance spelling, which clause
(4b) already named, so a regression is attributable to one clause or the other.
"""


class Row:
    def save(self) -> str:
        return "saved"


class Manager:
    def create(self) -> Row:
        return Row()


class ManagerDescriptor:
    def __get__(self, obj, objtype=None) -> Manager:
        return Manager()


class ModelMeta(type):
    def __new__(mcls, name, bases, ns):
        cls = super().__new__(mcls, name, bases, ns)
        cls.objects = ManagerDescriptor()
        return cls


class Model(metaclass=ModelMeta):
    pass


class Widget(Model):
    pass


class Plain:
    """No metaclass — `absent` is simply not a member of this class."""


class Instance:
    def on_an_instance(self) -> str:
        # EXPECT: miss — CONTROL for clause (4b), the instance spelling. Named
        # attribute_absent_on_type rather than class_attribute_absent, and unresolvable
        # either way, which is why it is a declared miss rather than a link.
        return self.nothere.save()


def metaclass_installed() -> str:
    # EXPECT: miss — `objects` is installed by ModelMeta at class creation, so no
    # declaration exists for the engine to find. Reported class_attribute_absent.
    return Widget.objects.create().save()


def plainly_absent() -> str:
    # EXPECT: miss — the same clause with no metaclass involved, so the reason is keyed
    # on the OBJECT being a class rather than on how the attribute got there.
    return Plain.absent.save()


def drive() -> str:
    # Called directly rather than through a loop over a tuple of functions: a callee held
    # in a loop variable is its own unresolved shape and would add an unrelated `no_rule`
    # to this family's reason census.
    parts = [metaclass_installed()]
    try:
        parts.append(plainly_absent())
    except AttributeError:
        parts.append("absent")
    try:
        parts.append(Instance().on_an_instance())
    except AttributeError:
        parts.append("absent")
    return " ".join(parts)

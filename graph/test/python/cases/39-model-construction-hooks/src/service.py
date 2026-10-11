from models import Gadget, Gizmo, Plain, Widget


def make_widget(data: dict):
    return Widget(**data)


def load_widget(data: dict):
    return Widget.model_validate(data)


def make_gizmo():
    return Gizmo(size=1)


def make_gadget(size: int):
    return Gadget(size)


def make_plain():
    return Plain()

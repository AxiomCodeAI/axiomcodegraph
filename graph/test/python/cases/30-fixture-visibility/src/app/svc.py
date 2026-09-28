"""Production code. Each function is reached from a test ONLY through one fixture body,
so which fixture a test is wired to decides which of these it reaches."""


def make_repo():
    return "repo"


def make_service():
    return "service"


def make_cache():
    return "cache"


def make_client():
    return "client"


def make_user(name):
    return {"name": name}


def make_widget():
    return "widget"


def make_orphan():
    return "orphan"


def make_helper():
    return "helper"


def make_hidden():
    return "hidden"


def module_account():
    return "module"


def class_account():
    return "class"

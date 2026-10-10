from app import views


def handle(name, req):
    handler = getattr(views, name)
    return handler(req).render()


def handle_local(name, req):
    handler = getattr(views, name)
    resp = handler(req)
    text = resp.render()
    resp.close()
    return text


def handle_optional(name, req):
    handler = getattr(views, name)
    return handler(req).render()


def handle_builder(name, req):
    handler = getattr(views, name)
    return handler(req).step().done().render()


def handle_untyped(name, req):
    handler = getattr(views, name)
    out = handler(req)
    return out.render()


async def handle_async(name, req):
    handler = getattr(views, name)
    resp = await handler(req)
    return resp.render()


def handle_reassigned(name, req, other):
    handler = getattr(views, name)
    resp = handler(req)
    resp = other
    return resp.render()


def two_on_a_line(a, b):
    return a.run() + b.run()

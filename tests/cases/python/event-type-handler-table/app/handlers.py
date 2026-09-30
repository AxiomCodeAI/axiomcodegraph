from app.topics import Topics


def on_created(env):
    return env["payload"]


def on_deleted(env):
    return env["payload"]["id"]


HANDLERS = {
    Topics.CREATED: on_created,
    "doc.deleted": on_deleted,
}


def consume(msg):
    handler = HANDLERS.get(msg["headers"]["type"])
    if handler:
        handler(msg)

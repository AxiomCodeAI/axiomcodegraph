from app.topics import Topics


def create(bus, doc):
    bus.publish(Topics.CREATED, doc)
    return doc

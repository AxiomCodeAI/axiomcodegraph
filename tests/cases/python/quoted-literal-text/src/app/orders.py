KEY = "a \"b\" c"
PLAIN = "a plain value"


def route(path):
    def deco(f):
        return f
    return deco


def send(subject):
    return subject


@route("/orders/{code}")
def notify():
    return send('Order "Foo" Is Late')


@route("""/triple/{code}""")
def notify_triple():
    return send("The order has shipped")

from webkit import Client


class App:
    def __call__(self, environ, start):
        return self.dispatch(environ)

    def dispatch(self, environ):
        return "ok"

    def test_client(self):
        return AppClient(self)


class AppClient(Client):
    def open(self, path):
        return super().open(path)


class Unrelated:
    def open(self, path):
        return path

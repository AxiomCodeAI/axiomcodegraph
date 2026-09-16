class HTTPConnection:
    def __init__(self, headers):
        self._headers = headers

    @property
    def headers(self):
        return self._headers


class Request(HTTPConnection):
    pass


def read_one(r: Request):
    return r.headers


def read_two(r: Request):
    return r.headers

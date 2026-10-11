def send_bytes():
    return b"sent"


def open_raw():
    return "raw"


class Session:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def request(self, url):
        return send_bytes()


class Pool:
    def __enter__(self):
        return open_raw()

    def __exit__(self, *exc):
        return False

    def request(self, url):
        return send_bytes()


def fetch(url):
    with Session() as session:
        return session.request(url)


def fetch_pooled(url):
    with Pool() as conn:
        return conn.request(url)

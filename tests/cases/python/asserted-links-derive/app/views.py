from typing import Optional


class Response:
    def render(self) -> str:
        return "ok"

    def close(self) -> None:
        return None


class Builder:
    def step(self) -> "Builder":
        return self

    def done(self) -> Response:
        return Response()


def make_response(req) -> Response:
    return Response()


def maybe_response(req) -> Optional[Response]:
    return Response()


def make_builder(req):
    return Builder()


def untyped(req):
    return req


async def fetch(req) -> Response:
    return Response()

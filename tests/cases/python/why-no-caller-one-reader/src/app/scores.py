from flask_caching import Cache
from flask_restx import Namespace, Resource
from app.decorators import admins_only
from app.hooks import app_hooks

cache = Cache()
boards = Namespace("boards")


@cache.memoize(timeout=60)
def get_standings(count=None):
    return []


@admins_only
def refresh_board():
    return 1


@app_hooks.before_request
def load_user():
    return None


def _unused_helper():
    return 2


class Board(Resource):
    @boards.doc("Endpoint to list the boards")
    def get(self):
        return []

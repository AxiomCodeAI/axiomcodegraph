import logging
from http.server import BaseHTTPRequestHandler

log = logging.getLogger(__name__)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        pass


class Orphan:
    def x(self):
        pass


def notify(evt):
    log.info(evt)


def on_event(evt):
    return evt


def lonely():
    return 1

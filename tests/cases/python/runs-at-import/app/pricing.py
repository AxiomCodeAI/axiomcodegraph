from app.settings import settings


def quote(cents):
    return f"{settings.url}:{cents}"

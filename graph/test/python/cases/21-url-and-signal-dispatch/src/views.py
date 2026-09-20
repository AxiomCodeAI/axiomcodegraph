"""Views in their own module. A real urls.py is always cross-module."""


def profile(request, key):
    return _render_view(key)


def settings_page(request):
    return _render_view("settings")


def _render_view(key):
    """Reached only through a view, from the route table in another module."""
    return key

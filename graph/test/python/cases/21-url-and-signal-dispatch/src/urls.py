"""The route table in its own module, naming views imported from another.

Both spellings a project actually writes are here: the module-qualified reference and
the directly imported name.
"""
from signals import Signal  # noqa: F401  (keeps the module shape realistic)
import views
from views import settings_page


def path(route, view, name=None):
    return (route, view, name)


urlpatterns = [
    path("profile/<key>/", views.profile, name="profile"),
    path("settings/", settings_page, name="settings"),
]

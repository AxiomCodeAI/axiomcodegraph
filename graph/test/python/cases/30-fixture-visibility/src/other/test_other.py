def test_widget(widget):
    """other/more_fixtures.py::widget, through this directory's conftest."""
    assert widget


def test_service_here(service):
    """testsupport/plugin.py::service: a plugin fixture is visible outside tests/ too."""
    assert service

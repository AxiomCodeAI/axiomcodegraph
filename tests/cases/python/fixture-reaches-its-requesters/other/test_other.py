import pytest

def test_widget(widget):
    assert widget


@pytest.mark.usefixtures("widget")
def test_marks_widget():
    assert True

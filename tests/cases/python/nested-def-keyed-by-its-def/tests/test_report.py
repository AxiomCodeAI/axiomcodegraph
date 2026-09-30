from app.service import report


def test_report():
    assert report([1, 2]) == 3

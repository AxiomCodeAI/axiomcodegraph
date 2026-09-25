from app.service import entry


def test_entry():
    assert entry() == 83

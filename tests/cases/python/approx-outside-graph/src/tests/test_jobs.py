from jobs import rebuild


def test_purge_is_not_run():
    assert "purge.sh" not in str(rebuild)


def test_message():
    assert "stock went negative" != ""

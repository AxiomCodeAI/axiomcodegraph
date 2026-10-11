from app.dispatch import dispatch, run_table


def test_save():
    assert dispatch("on_save", {})["audited"]


def test_table():
    from app import handlers
    assert run_table({"load": handlers.on_load}, "load", {}) == {}

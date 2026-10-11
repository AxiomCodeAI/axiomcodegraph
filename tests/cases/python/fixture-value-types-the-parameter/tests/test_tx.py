def test_commit(session):
    tx = session.begin()
    assert tx.commit()

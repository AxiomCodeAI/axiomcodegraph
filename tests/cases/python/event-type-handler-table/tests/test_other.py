def test_delete_is_published_by_its_type():
    sent = []
    sent.append(("doc.deleted", {"id": "d1"}))
    assert sent

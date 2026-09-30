import pytest


def test_admin_by_name(request):
    user = request.getfixturevalue("admin_user")
    assert user["role"] == "admin"


def lookup(request):
    return request.getfixturevalue("guest_user")


def test_names_guest_in_a_message(request):
    marker = request.node.get_closest_marker("guest_user")
    assert marker is None


@pytest.mark.parametrize("server", ["local_srv", "remote_srv"])
def test_each_server(server, request):
    url = request.getfixturevalue(server)
    assert url


@pytest.mark.parametrize("label", ["audit_log"])
def test_label_is_only_a_value(label):
    assert label == "audit_log"


def test_guest_as_a_parameter(guest_user):
    assert guest_user["role"] == "guest"


def test_audit_as_a_parameter(audit_log):
    assert audit_log == []


@pytest.mark.parametrize("expected, server", [(200, "staging_srv"), ("mirror_srv", "local_srv")])
def test_server_and_code(expected, server, request):
    url = request.getfixturevalue(server)
    assert url and expected


def test_mirror_as_a_parameter(mirror_srv):
    assert mirror_srv


@pytest.mark.parametrize(["retries", "target"], [(1, "backup_srv"), (2, "local_srv")])
def test_target_from_a_name_list(retries, target, request):
    assert request.getfixturevalue(target) and retries

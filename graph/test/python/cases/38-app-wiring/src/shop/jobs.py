from django.core.management import call_command


def nightly():
    call_command("close_orders")


def unknown():
    """No command module of this name: nothing to reach."""
    call_command("reopen_orders")

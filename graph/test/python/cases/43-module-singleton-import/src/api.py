"""Imports the singleton whose name collides with its module's last segment."""

from order_service import order_service


def cancel_endpoint(oid):
    return order_service.cancel(oid)

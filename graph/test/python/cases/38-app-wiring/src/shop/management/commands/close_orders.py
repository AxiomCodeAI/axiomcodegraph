"""A management command: the module's file name is the command's name."""
from django.core.management.base import BaseCommand

from shop.orders import close_all


class Command(BaseCommand):
    def handle(self, *args, **options):
        return close_all()

    def summary(self):
        """Not what the command runner calls."""
        return "close"

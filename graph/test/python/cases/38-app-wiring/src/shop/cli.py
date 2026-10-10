"""A class called Command outside a commands package: not a management command."""


class Command:
    def handle(self, *args, **options):
        return 0

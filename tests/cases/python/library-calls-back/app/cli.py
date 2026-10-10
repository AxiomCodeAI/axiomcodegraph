import clikit
from clikit.core import Command


class AppGroup(Command):
    def make_context(self, args):
        return super().make_context(args)


@clikit.command()
def greet():
    return "hi"

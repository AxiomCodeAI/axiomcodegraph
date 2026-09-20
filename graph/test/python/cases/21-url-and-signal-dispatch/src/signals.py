"""The signal object declared in its own module, which is where every project puts it.

A publisher and a receiver never share a file in real code: both import the signal from
here. Each importing module gets its OWN import binding, so a rule that joins the two
ends on the raw binding hash finds nothing. A single-file case cannot show that, because
every occurrence there shares one binding.
"""


class Signal:
    def send(self, sender, **kw):
        return sender

    def connect(self, fn, **kw):
        return fn


shipped = Signal()
never_shipped = Signal()

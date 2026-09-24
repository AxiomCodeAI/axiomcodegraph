from pkg.lib import f_plain, f_wraps, f_passthrough, f_opaque, undecorated
from pkg.lib import f_plain as aliased
import pkg.lib as lib


def run():
    f_plain(1)
    lib.f_plain(2)
    f_wraps(3)
    lib.f_wraps(4)
    aliased(5)
    f_passthrough(6)
    lib.f_passthrough(7)
    f_opaque(8)
    lib.f_opaque(9)
    undecorated(10)
    lib.undecorated(11)


run()

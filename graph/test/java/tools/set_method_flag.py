#!/usr/bin/env python3
"""Set or clear an access flag on one method of a .class file, in place.

WHY THIS EXISTS. The class-file oracle has to drop a callee whose declaration is ACC_SYNTHETIC or
ACC_BRIDGE, because a compiler-generated member is not a call the source makes. That cannot be
tested with javac alone: every synthetic member javac emits is already excluded by NAME
(`$values`, `values`, `valueOf`, `$deserializeLambda$`, `access$*`), which is exactly why the
gap was invisible -- it only appears with a compiler whose generated members are named
differently, and requiring that compiler to run the test would mean the test does not run.

So the flag is set here instead, on an ordinary method, which asserts the oracle's behaviour
directly and on every machine. See issue #199 and tools/synthetic-callee-test.sh.

usage: set_method_flag.py <file.class> <methodName> <hex-flag> [--clear]
       set_method_flag.py Foo.class helper 0x1000          # add ACC_SYNTHETIC
"""
import struct
import sys

# Constant-pool entry sizes past the 1-byte tag. Utf8 (1) and the two 8-byte
# constants are special-cased below; Long/Double also consume TWO pool slots.
FIXED = {3: 4, 4: 4, 7: 2, 8: 2, 9: 4, 10: 4, 11: 4, 12: 4,
         15: 3, 16: 2, 17: 4, 18: 4, 19: 2, 20: 2}


def parse_pool(b):
    """-> (utf8 by index, offset just past the pool)"""
    count = struct.unpack_from('>H', b, 8)[0]
    off = 10
    utf8 = {}
    i = 1
    while i < count:
        tag = b[off]
        off += 1
        if tag == 1:
            n = struct.unpack_from('>H', b, off)[0]
            utf8[i] = b[off + 2:off + 2 + n].decode('utf-8', 'replace')
            off += 2 + n
        elif tag in (5, 6):
            off += 8
            i += 1                      # Long and Double take two slots
        elif tag in FIXED:
            off += FIXED[tag]
        else:
            raise SystemExit(f'set_method_flag: unknown constant-pool tag {tag} at {off - 1}')
        i += 1
    return utf8, off


def skip_attributes(b, off):
    n = struct.unpack_from('>H', b, off)[0]
    off += 2
    for _ in range(n):
        length = struct.unpack_from('>I', b, off + 2)[0]
        off += 6 + length
    return off


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 3:
        raise SystemExit(__doc__)
    path, want, flag = args[0], args[1], int(args[2], 16)
    clear = '--clear' in sys.argv

    b = bytearray(open(path, 'rb').read())
    if struct.unpack_from('>I', b, 0)[0] != 0xCAFEBABE:
        raise SystemExit(f'set_method_flag: {path} is not a class file')
    utf8, off = parse_pool(b)

    off += 6                                            # access_flags, this_class, super_class
    ifaces = struct.unpack_from('>H', b, off)[0]
    off += 2 + 2 * ifaces
    fields = struct.unpack_from('>H', b, off)[0]        # fields
    off += 2
    for _ in range(fields):
        off = skip_attributes(b, off + 6)

    methods = struct.unpack_from('>H', b, off)[0]
    off += 2
    hits = 0
    for _ in range(methods):
        acc, name_i = struct.unpack_from('>HH', b, off)
        if utf8.get(name_i) == want:
            new = acc & ~flag if clear else acc | flag
            struct.pack_into('>H', b, off, new)
            print(f'{path}: {want} flags 0x{acc:04x} -> 0x{new:04x}')
            hits += 1
        off = skip_attributes(b, off + 6)

    if not hits:
        raise SystemExit(f'set_method_flag: no method named {want} in {path}')
    open(path, 'wb').write(b)


if __name__ == '__main__':
    main()

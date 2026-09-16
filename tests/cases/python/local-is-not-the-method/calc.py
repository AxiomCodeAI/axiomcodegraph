def compute(values):
    running = 0
    for v in values:
        running += v
    return running

def caller_one(): return compute([1, 2])
def caller_two(): return compute([3])
def caller_three(): return caller_one() + caller_two()

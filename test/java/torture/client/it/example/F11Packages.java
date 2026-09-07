package it.example;

// f11 — PACKAGE NAMES THAT LOOK LIKE TEST DIRECTORIES. Nothing here is a test.
//
// A scorer that decides scope by matching directory names against a file path will drop this
// family: `it` is the top-level package of every Italian open-source library, and a class in
// `it.example` lives under `…/client/it/example/`. The same mistake was a real defect in the
// parser's source walk, which is why its src/test/java-gates/source-walk.ts pins `it` under
// MUST_SURVIVE — this is the scoring-side equivalent, and it had no gate.
//
// The path half is worse than the package half, because it is not a property of the project at
// all: matching an ABSOLUTE path means a checkout under a directory called `fixtures` or
// `examples` drops everything, and two people scoring the same revision get different numbers.

public class F11Packages {

    static class Helper {
        Helper() { }
        String use() { return "h"; }
    }

    // an explicitly written `new` — a real edge, and the one a scorer that drops constructor
    // targets from one side reports as missing
    String create() { return new Helper().use(); }

    // an ordinary call, so the family still scores something if constructors are ever excluded
    String plain(Helper h) { return h.use(); }

    // a throw of a client exception: `new` again, in the shape that dominates a real project's
    // constructor edges
    void fail() { throw new Failure("boom"); }

    static class Failure extends RuntimeException {
        Failure(String m) { super(m); }
    }
}

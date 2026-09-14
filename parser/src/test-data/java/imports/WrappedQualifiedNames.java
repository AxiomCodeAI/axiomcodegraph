package com.axiomcode.test.imports;

/*
 * Acceptance fixture for qualified names split across a line break.
 *
 * JLS 3.6 permits whitespace, including a line terminator, between the
 * identifiers and dots of a qualified name, so every import below compiles and
 * names exactly what its single-line form would name.
 *
 * Two defects met in one row here. The value kept the line break, so
 * `importedPath` was "java.util.\nOptional" rather than "java.util.Optional";
 * and the writer did not escape it, so one logical row was written across two
 * physical lines and was dropped downstream on the header field-count check.
 *
 * The trigger is a formatting accident or a generator that wraps long lines,
 * but it is deterministic once present: the row is gone on every run.
 */
import java.util.
Optional;

import java.util.function
.Function;

import java.util
    .concurrent
    .Callable;

import static java.lang.Math
.PI;

public class WrappedQualifiedNames {

    Optional<String> optional = Optional.empty();
    Function<String, String> identity = s -> s;
    Callable<String> callable = () -> "";
    double pi = PI;
}

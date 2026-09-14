/*
 * Acceptance fixture for module import declarations (JEP 511, final in Java 25).
 *
 * No tree-sitter-java release parses this construct, checked through 0.23.5.
 * What the grammar produces is a malformed import_declaration, with `module`
 * swallowed into the qualified name and an ERROR node beside it:
 *
 *   import_declaration
 *     import
 *     scoped_identifier          <- text is "module java.base"
 *       identifier = "module"
 *       ERROR
 *         identifier = "java"
 *       .
 *       identifier = "base"
 *
 * Read naively that is a single-type import of a type named `base` in a package
 * named `module java`, which is a row that describes something that does not
 * exist. The extractor recognises the shape instead and classifies it as MODULE.
 *
 * The remaining imports are here to hold the ordinary classification steady:
 * whatever recognises the module form must not reclassify any of them.
 *
 * This file compiles under `javac --release 24 --enable-preview`, and
 * unconditionally on Java 25.
 */
import module java.base;
import module java.sql;

import java.util.List;
import java.util.ArrayList;
import static java.lang.Math.PI;
import java.util.concurrent.*;
import static java.lang.Integer.*;

public class ModuleImportDeclarations {

    void go() {
        List<String> values = new ArrayList<>();
        values.add(String.valueOf(PI));
    }
}

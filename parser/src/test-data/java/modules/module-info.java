/**
 * Acceptance fixture for module declarations (JLS 7.7).
 *
 * The oracle for every assertion is javac's own module descriptor: compile an
 * equivalent module and read `javap -verbose module-info.class`, which reports
 * three `requires` (one ACC_TRANSITIVE, one ACC_STATIC_PHASE), two `exports`
 * (one qualified `to`), one `opens`, one `uses` and one `provides ... with`.
 *
 * The multi-target directives below flatten to one row per target: `exports
 * com.example.multi to a, b` is two rows differing only in targetName and
 * position, so a consumer joins on a column instead of splitting a string.
 */
module com.example.app {
    requires java.base;
    requires transitive java.sql;
    requires static java.compiler;

    exports com.example.api;
    exports com.example.internal to com.example.client;
    exports com.example.multi to com.example.one, com.example.two;

    opens com.example.model;

    uses com.example.spi.Service;
    provides com.example.spi.Service with com.example.impl.ServiceImpl;
    provides com.example.spi.Codec with com.example.impl.FastCodec, com.example.impl.SafeCodec;
}

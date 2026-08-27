package testcases.config;

/**
 * Engine test — ANNOTATION ARGUMENT VALUES.
 *
 * annotation_flow.dl reads annotation NAMES. Everything an annotation SAYS —
 * 9 columns per argument — had zero consumers. This case pins each argument shape:
 *
 *   @Value("${a.b}")            a config key                -> config_binding
 *   @Value("${a.b:default}")    a key WITH a default        -> binding, no unknown
 *   @Value("${a.missing}")      a key defined nowhere       -> DECLARED unknown
 *   @Value("literal")           not a placeholder at all    -> no binding
 *   using = FooCodec.class      a CLASS_REFERENCE           -> config_class_ref
 *   fallbacks = {A.class,B.class} an ARRAY argument         -> a row PER ELEMENT
 *   index = @Idx(on = C.class)  a NESTED annotation         -> the child's own
 *                                                              argument is resolved,
 *                                                              through the enclosing
 *                                                              file's imports
 *   timeout = 60 * 1000         a computed value            -> no false class ref
 *
 * @ConfigurationProperties binds a whole key subtree to fields, including Spring's
 * relaxed kebab-case spelling (svc.max-retries -> maxRetries) and one nested level.
 */

@interface Value { String value(); }
@interface ConfigurationProperties { String prefix(); }
@interface Codec { Class<?> using(); Class<?>[] fallbacks(); Idx index(); int timeout(); }
@interface Idx { Class<?> on(); }

class FooCodec { }
class AltCodecA { }
class AltCodecB { }
class IndexedBy { }

@ConfigurationProperties(prefix = "svc")
class SvcProps {
    String host;            // svc.host        — exact spelling
    int maxRetries;         // svc.max-retries — relaxed (kebab) spelling
    Nested nested;          // svc.nested.*    — one level down

    String host()    { return host; }
    int    retries() { return maxRetries; }
}

class Nested {
    String path;            // svc.nested.path
    String path() { return path; }
}

class Consumer {
    @Value("${svc.host}")        String host;
    @Value("${svc.timeout:5000}") String timeout;   // default => chain terminates
    @Value("${svc.missing}")     String missing;    // no such key => declared unknown
    @Value("plain-literal")      String plain;      // no placeholder => no binding

    String use() { return host + timeout + missing + plain; }
}

@Codec(using = FooCodec.class,
       fallbacks = { AltCodecA.class, AltCodecB.class },
       index = @Idx(on = IndexedBy.class),
       timeout = 60 * 1000)
class Annotated { }

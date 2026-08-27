package testcases.config;

/**
 * Engine test — .properties AND .yaml, ONE KEY SPACE.
 *
 * Spring merges application.properties and application.yml into a single key space,
 * so a placeholder written in YAML may resolve against a key defined in .properties.
 * Modelling the two formats separately would miss exactly that, and it is the shape
 * that breaks silently: both files parse, both look fine, the link is just absent.
 *
 * Pinned here:
 *   a placeholder chain WITHIN .properties       app.url   -> app.host, app.port
 *   a chain CROSSING format boundaries           svc.base  -> app.url  (yaml -> properties)
 *   a chain two hops deep                        svc.probe -> svc.base -> app.url -> app.host
 *   ${k:default}                                 terminates; not a gap
 *   ${k} with no k anywhere                      DECLARED unknown (undefined_key)
 *   a value that NAMES A CLASS                   config_class_ref + config_entry_point
 *   a value that merely looks FQN-ish            no false class reference
 *
 * The two parsers disagree on the segment type for the SAME `${a.b}` (.properties
 * says PROPERTY_REFERENCE, YAML says ENV_VARIABLE); trusting either vocabulary alone
 * silently loses one whole format, so both are accepted and the raw value is
 * re-scanned as ground truth.
 */

class PipelineStage {
    String handle(String in) { return in; }
}

class Runner {
    void go() { new PipelineStage().handle("x"); }
}

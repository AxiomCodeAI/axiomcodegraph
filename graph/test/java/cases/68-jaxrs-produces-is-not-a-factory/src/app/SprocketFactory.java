package app;

import jakarta.enterprise.inject.*;

class Sprocket {}

/** Control: CDI's @Produces imported on demand makes a factory. */
class SprocketFactory {
    @Produces
    Sprocket sprocket() { return new Sprocket(); }
}

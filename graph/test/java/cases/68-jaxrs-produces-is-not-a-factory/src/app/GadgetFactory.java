package app;

import jakarta.enterprise.inject.Produces;

class Gadget {}

/** Control: CDI's @Produces imported by name makes a factory. */
class GadgetFactory {
    @Produces
    Gadget gadget() { return new Gadget(); }
}

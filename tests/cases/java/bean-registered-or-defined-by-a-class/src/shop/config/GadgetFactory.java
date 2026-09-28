package shop.config;

/** Near miss: a method that returns a Gadget, with no @Bean and no @Configuration. */
public class GadgetFactory {
    public Gadget gadget() { return new Gadget(); }
}

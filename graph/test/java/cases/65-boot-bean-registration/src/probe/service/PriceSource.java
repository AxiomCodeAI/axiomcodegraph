package probe.service;

/** CONTROL: a plain interface with no implementation. Stays unsatisfied. */
public interface PriceSource {
    long price(Long id);
}

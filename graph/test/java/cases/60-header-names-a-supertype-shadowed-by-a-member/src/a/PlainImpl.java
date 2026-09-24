package a;

// The control: no member type of the header's name, so the supertype was always found.
public class PlainImpl implements Builder<Integer> {
    @Override
    public Integer build() { return 1; }
}

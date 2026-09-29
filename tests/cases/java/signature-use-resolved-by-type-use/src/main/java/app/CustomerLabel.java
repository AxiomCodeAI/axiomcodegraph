package app;

public class CustomerLabel {
    public String label(Customer c) {
        return "#" + c.getId();
    }
}

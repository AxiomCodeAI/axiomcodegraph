package app;

public class CustomerDesk {
    public Customer open() {
        return new Customer();
    }

    // control: the name in a comment and a string is text, not a signature: Customer
    public String note() {
        return "Customer";
    }
}

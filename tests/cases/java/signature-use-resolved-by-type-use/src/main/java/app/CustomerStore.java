package app;

import java.util.List;

public interface CustomerStore {
    Customer findById(Long id);

    List<Customer> findAll();

    void save(Customer customer);
}

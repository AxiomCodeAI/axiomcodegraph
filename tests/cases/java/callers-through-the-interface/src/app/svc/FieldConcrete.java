package app.svc;

import app.store.JdbcStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class FieldConcrete {
    @Autowired private JdbcStore store;
    public void place() { store.save("k"); }
}

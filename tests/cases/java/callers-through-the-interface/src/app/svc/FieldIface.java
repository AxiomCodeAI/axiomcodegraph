package app.svc;

import app.store.Store;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class FieldIface {
    @Autowired private Store store;
    public void place() { store.save("k"); }
}

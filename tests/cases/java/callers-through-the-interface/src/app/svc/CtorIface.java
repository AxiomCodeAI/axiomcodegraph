package app.svc;

import app.store.Store;
import org.springframework.stereotype.Service;

@Service
public class CtorIface {
    private final Store store;
    public CtorIface(Store store) { this.store = store; }
    public void place() { store.save("k"); }
}

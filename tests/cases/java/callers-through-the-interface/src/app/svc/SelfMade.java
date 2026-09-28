package app.svc;

import app.store.JdbcStore;

public class SelfMade {
    public void place() { new JdbcStore().save("k"); }
}

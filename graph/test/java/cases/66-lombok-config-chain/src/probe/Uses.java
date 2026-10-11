package probe;

public class Uses {
    public void conf(Conf c) {
        c.setHost("h").setPort(1).apply();
    }

    public void plain(Plain p) {
        p.setHost("h").setPort(1);
        p.apply();
    }
}

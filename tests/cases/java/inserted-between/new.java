package pkg;
public class Port {
    private int port;

    public int getPort() {
        return port;
    }

    public boolean hasPort() {
        return port > 0;
    }

    public void setPort(int p) {
        this.port = p;
    }
}

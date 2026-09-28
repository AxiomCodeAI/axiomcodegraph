package demo;

public class Caller {
    public void m() { Sink.modeA(); }
    public void n() { Sink2.modeA(); }
    public void k() { Sink.modeB(); Sink2.modeB(); }
}

public class Probe {
    void a() {
        b();            // receiverless instance call (implicit this)
        this.c();       // explicit this
        s();            // receiverless static call (same class)
        Probe.s();      // qualified static call (same class)
        Probe p = new Probe();
        p.b();          // explicit local receiver
    }
    void b() {}
    void c() {}
    static void s() {}
    Probe() {}
}

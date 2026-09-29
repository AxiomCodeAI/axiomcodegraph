package probe;

/** #1478: a self type fixed one level down (control) and two levels down. */
class DirectStub extends SelfBase<DirectStub> {
    void send() {
    }
}

class ChainStub extends SelfMid<ChainStub> {
    void send() {
    }
}

public class Stubs {
    void direct() {
        new DirectStub().withTimeout(5).send();
    }

    void chained() {
        new ChainStub().withTimeout(5).send();
    }
}

package probe;

import example.lib.LibLocator;
import example.lib.LibSelfMid;
import example.lib.LibService;

/** The same three shapes with the generic declared in a LIBRARY (#1478, #1412, #1547). */
class LibChainStub extends LibSelfMid<LibChainStub> {
    void send() {
    }
}

public class LibUses extends LibService<OrderMapper> {
    void chained() {
        new LibChainStub().withTimeout(5).send();
    }

    int field() {
        return baseMapper.findOpen();
    }

    int getter() {
        return getBaseMapper().findClosed();
    }

    void locate() {
        LibLocator.getBean(OrderStore.class).save("x");
    }
}

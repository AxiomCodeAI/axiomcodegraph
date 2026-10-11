package app.widgets;

import gen.v2.*;

public class WidgetClient {
    private WidgetGrpc.WidgetBlockingStub stub;

    String build(String sku) { return stub.build(sku); }
}

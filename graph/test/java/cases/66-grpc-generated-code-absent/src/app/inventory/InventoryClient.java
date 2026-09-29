package app.inventory;

public class InventoryClient {
    private InventoryGrpc.InventoryBlockingStub stub;

    String reserve(String sku) { return stub.reserve(sku); }
}

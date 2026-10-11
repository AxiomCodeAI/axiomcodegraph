package app.inventory;

import io.grpc.stub.StreamObserver;

// the generated holder lives in this file's own package, so no import names it
public class InventoryService extends InventoryGrpc.InventoryImplBase {
    @Override
    public void reserve(String request, StreamObserver<String> responseObserver) {
        responseObserver.onNext(request);
    }
}

// a subclass of the service inherits the handler role for what it declares
class AuditedInventoryService extends InventoryService {
    @Override
    public void reserve(String request, StreamObserver<String> responseObserver) {
        super.reserve(request, responseObserver);
    }
}

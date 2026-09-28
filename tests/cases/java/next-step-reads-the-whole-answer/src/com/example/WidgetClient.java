package com.example;

public class WidgetClient {
    private final WidgetServiceGrpc.WidgetServiceBlockingStub stub = null;
    public String placeBlocking(String req) { return stub.placeWidget(req); }
}

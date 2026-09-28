package com.example;

public final class WidgetServiceGrpc {
    public static abstract class WidgetServiceImplBase {
        public void placeWidget(String req) { }
    }
    public static class WidgetServiceBlockingStub {
        public String placeWidget(String req) { return null; }
    }
}

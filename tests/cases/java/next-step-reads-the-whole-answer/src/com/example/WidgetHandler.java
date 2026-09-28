package com.example;

public class WidgetHandler extends WidgetServiceGrpc.WidgetServiceImplBase {
    private final WidgetStore store = new WidgetStore();
    @Override
    public void placeWidget(String req) { store.save(req); }
}

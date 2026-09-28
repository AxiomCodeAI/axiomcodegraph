package com.example;

public class RowExtractor extends Extractor<Order, OrderLine> {
    public RowExtractor() { super((rs, i) -> new Order(), (rs, i) -> new OrderLine(rs.getString(1))); }
    @Override
    protected void add(Order root, OrderLine child) { root.lines.add(child); }
}

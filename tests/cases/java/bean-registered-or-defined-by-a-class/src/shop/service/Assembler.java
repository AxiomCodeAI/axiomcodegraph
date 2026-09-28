package shop.service;

import org.springframework.stereotype.Service;
import shop.config.Gadget;
import shop.config.Widget;

@Service
public class Assembler {
    private final Widget widget;
    private final Gadget gadget;

    public Assembler(Widget widget, Gadget gadget) {
        this.widget = widget;
        this.gadget = gadget;
    }

    public String build() { return widget.name() + gadget.name(); }
}

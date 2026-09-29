package app.widgets;

import jakarta.validation.Valid;
import org.springframework.stereotype.Controller;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;

@Controller
public class WidgetController {
    @InitBinder("widget")
    void initBinder(WebDataBinder binder) { binder.setValidator(new WidgetValidator()); }

    /** Validated through the binder: the attribute is `widget`, the type's default name. */
    @PostMapping("/widgets")
    String create(@Valid Widget widget, BindingResult result) { return result.hasErrors() ? "form" : "ok"; }

    /** Validated through the binder: the attribute is named explicitly. */
    @PostMapping("/widgets/named")
    String named(@Valid @ModelAttribute("widget") Widget w, BindingResult result) { return result.hasErrors() ? "form" : "ok"; }

    /** Control: a direct call, already an edge. */
    @PostMapping("/widgets/check")
    String check(Widget widget, BindingResult result) {
        new WidgetValidator().validate(widget, result);
        return result.hasErrors() ? "form" : "ok";
    }

    /** Near miss: not @Valid, so the binder does not validate. */
    @PostMapping("/widgets/preview")
    String preview(Widget widget, BindingResult result) { return "preview"; }

    /** Near miss: @Valid, but the attribute is `gadget`, which the binder does not name. */
    @PostMapping("/gadgets")
    String gadget(@Valid Gadget gadget, BindingResult result) { return "ok"; }

    /** Near miss: @Valid, but the attribute is renamed away from `widget`. */
    @PostMapping("/widgets/other")
    String other(@Valid @ModelAttribute("draft") Widget draft, BindingResult result) { return "ok"; }
}

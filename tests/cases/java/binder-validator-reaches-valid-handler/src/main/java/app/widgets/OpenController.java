package app.widgets;

import org.springframework.stereotype.Controller;
import org.springframework.validation.BindingResult;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.web.bind.annotation.PostMapping;

/** A binder with no names applies to every attribute; @Validated counts as @Valid. */
@Controller
public class OpenController {
    @InitBinder
    void initBinder(WebDataBinder binder) { binder.addValidators(new WidgetValidator()); }

    @PostMapping("/open")
    String open(@Validated Gadget gadget, BindingResult result) { return "ok"; }
}

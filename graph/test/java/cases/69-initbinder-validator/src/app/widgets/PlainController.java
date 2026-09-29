package app.widgets;

import jakarta.validation.Valid;
import org.springframework.stereotype.Controller;
import org.springframework.validation.BindingResult;
import org.springframework.web.bind.annotation.PostMapping;

/** Near miss: @Valid in a controller with no @InitBinder, so no validator of ours runs. */
@Controller
public class PlainController {
    @PostMapping("/plain")
    String plain(@Valid Widget widget, BindingResult result) { return "ok"; }
}

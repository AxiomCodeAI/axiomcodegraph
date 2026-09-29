package app.widgets;

import org.springframework.validation.Errors;
import org.springframework.validation.Validator;

public class WidgetValidator implements Validator {
    @Override
    public boolean supports(Class<?> clazz) { return Widget.class.isAssignableFrom(clazz); }

    @Override
    public void validate(Object target, Errors errors) {
        Widget w = (Widget) target;
        if (w.getName() == null) errors.rejectValue("name", "required");
    }
}

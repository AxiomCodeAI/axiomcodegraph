package app.widgets;

import org.springframework.stereotype.Service;

@Service
public class WidgetServiceImpl implements WidgetService {
    @Override
    public String build(String name) {
        return "widget:" + name;
    }
}

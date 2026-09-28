package probe;

import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

// control: an ApplicationListener for a type nothing publishes
@Component
public class WidgetListener implements ApplicationListener<WidgetBuilt> {
    @Override
    public void onApplicationEvent(WidgetBuilt event) { }
}

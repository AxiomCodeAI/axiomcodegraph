package dep;

import org.springframework.stereotype.Service;

/** SUBJECT B: the same construct at a CONCRETE declared type rather than an interface. */
@Service
public class WidgetStore {
    public String find(String id) {
        return "widget:" + id;
    }
}

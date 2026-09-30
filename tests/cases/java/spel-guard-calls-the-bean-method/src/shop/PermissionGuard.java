package shop;

import org.springframework.stereotype.Component;

@Component
public class PermissionGuard {
    public boolean canEdit(String orderId) { return orderId != null; }

    public boolean canEdit(String orderId, String env) { return env != null; }

    public boolean canView(String orderId) { return true; }
}

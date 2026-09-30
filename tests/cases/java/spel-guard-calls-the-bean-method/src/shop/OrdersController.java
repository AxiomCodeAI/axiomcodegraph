package shop;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.access.prepost.PostFilter;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
public class OrdersController {
    @PreAuthorize("@permissionGuard.canEdit(#orderId)")
    @PostMapping("/orders/{orderId}")
    public String edit(String orderId) { return orderId; }

    @PreAuthorize("@permissionGuard.canEdit(#orderId, 'prod') and @audits.allowed(#orderId)")
    public String editProd(String orderId) { return orderId; }

    @PostFilter("@audits.allowed(filterObject)")
    public List<String> listAll() { return List.of(); }

    @PreAuthorize("@reviewGuard.mayReview(#orderId)")
    public String review(String orderId) { return orderId; }

    // near miss: the bean is named "audits", so "@auditRules" names no bean
    @PreAuthorize("@auditRules.archived(#orderId)")
    public String archive(String orderId) { return orderId; }

    // near miss: the guard's name written as a role string, not as a bean reference
    @PreAuthorize("hasRole('permissionGuard.canView')")
    public String view(String orderId) { return orderId; }
}

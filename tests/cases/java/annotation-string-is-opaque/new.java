package web;

public class Orders {
    @PreAuthorize("@guard.canCreate(#shopId, 'orders') or @guard.isAdmin()")
    @PostMapping("/shops/{shopId}/orders")
    public String create(String shopId, java.util.List<String> lines) { return shopId; }

    @PreAuthorize("@guard.canRead(#shopId)")
    @GetMapping("/shops/{shopId}/orders")
    public String list(String shopId, @RequestParam(defaultValue = "a,(b") String sort) { return sort; }

    @PreAuthorize("@guard.canCancel(#shopId, 'x)')")
    public String cancel(String shopId, String reason) { return shopId; }
}

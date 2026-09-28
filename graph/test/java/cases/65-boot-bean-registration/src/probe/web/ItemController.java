package probe.web;

import org.springframework.web.bind.annotation.RestController;
import probe.service.ItemService;

/** CONTROL: a stereotype bean injected by type, known_bean before this change. */
@RestController
public class ItemController {
    private final ItemService service;

    public ItemController(ItemService service) {
        this.service = service;
    }
}

package demo.orders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import demo.security.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(OrdersApi.class)
@Import({SecurityConfig.class})
public class SecuredOrdersApiTest {
  @Autowired private MockMvc mvc;

  @Test
  public void listsOrders() throws Exception {
    mvc.perform(get("/orders"));
  }

  @Test
  public void namesAreFixed() {
    OrderNames.all();
  }
}

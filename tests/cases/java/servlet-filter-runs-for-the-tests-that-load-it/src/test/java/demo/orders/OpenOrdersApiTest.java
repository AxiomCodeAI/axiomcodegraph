package demo.orders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(OrdersApi.class)
public class OpenOrdersApiTest {
  @Autowired private MockMvc mvc;

  @Test
  public void listsOrdersWithoutTheSecurityChain() throws Exception {
    mvc.perform(get("/orders"));
  }
}

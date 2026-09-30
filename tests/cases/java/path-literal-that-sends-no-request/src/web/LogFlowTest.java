package web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

public class LogFlowTest {
    static final String LIST = "/logs/list";
    MockMvc mockMvc;

    @Test
    public void removes() throws Exception {
        mockMvc.perform(delete("/logs/7"));
    }

    @Test
    public void lists() throws Exception {
        mockMvc.perform(get(LIST));
    }

    @Test
    public void checksHealth() throws Exception {
        mockMvc.perform(get("/health"));
    }
}

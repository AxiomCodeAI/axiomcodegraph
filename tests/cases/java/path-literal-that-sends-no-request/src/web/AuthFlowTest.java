package web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

public class AuthFlowTest {
    MockMvc mockMvc;

    @Test
    public void logsIn() throws Exception {
        mockMvc.perform(post("/auth/login"));
    }
}

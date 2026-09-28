package shop;

import static io.restassured.module.mockmvc.RestAssuredMockMvc.given;

import org.junit.jupiter.api.Test;

public class RequestTest {
    @Test
    public void postsAPayload() {
        given().body(Payloads.make()).when().post("/orders").then().statusCode(200);
    }
}

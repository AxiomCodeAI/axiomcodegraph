package shop;

import static io.restassured.module.mockmvc.RestAssuredMockMvc.given;

import org.junit.jupiter.api.Test;

public class OrdersCreateTest {
    @Test
    public void createsAnOrder() {
        given().body("{}").when().post("/orders").then().statusCode(201);
    }

    @Test
    public void rejectsAnEmptyOrder() {
        given().body("").when().post("/orders").then().statusCode(422);
    }

    @Test
    public void addsALine() {
        given().body("{}").when().post("/orders/lines").then().statusCode(201);
    }
}

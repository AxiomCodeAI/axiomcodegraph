package shop;

import static io.restassured.module.mockmvc.RestAssuredMockMvc.given;

import org.junit.jupiter.api.Test;

public class OrdersListTest {
    @Test
    public void listsOrders() {
        given().when().get("/orders").then().statusCode(200);
    }

    @Test
    public void listsOrdersAgain() {
        given().when().get("/orders").then().statusCode(200);
    }

    @Test
    public void listsOrdersPaged() {
        given().param("page", 2).when().get("/orders").then().statusCode(200);
    }
}

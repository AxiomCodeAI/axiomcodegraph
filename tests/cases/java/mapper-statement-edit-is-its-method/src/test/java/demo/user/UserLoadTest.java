package demo.user;
import org.junit.jupiter.api.Test;
public class UserLoadTest {
    @Test
    void loadsOne() {
        new UserService(null).load("u-1");
    }
}

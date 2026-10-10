package demo.user;
public class UserService {
    private final UserMapper users;
    public UserService(UserMapper users) { this.users = users; }
    public User load(String id) { return users.findById(id); }
}

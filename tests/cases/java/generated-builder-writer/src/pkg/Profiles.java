package pkg;

import app.proto.UserView;

public class Profiles {
    public ProfileParam param(String e) {
        return ProfileParam.builder().email(e).build();
    }

    public UserView view(String e) {
        return UserView.newBuilder().email(e).build();
    }

    public void notify(Mailer m, String e) {
        m.email(e);
    }

    public boolean lock(Account a) {
        a.setLocked(true);
        return a.isLocked();
    }
}

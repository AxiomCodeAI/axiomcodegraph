package demo;

public class AccountService {
    public String ownerOf(Account a) { return a.getOwner(); }

    public long idOf(Account a) { return a.getId(); }

    public long plainIdOf(Plain p) { return p.getId(); }
}

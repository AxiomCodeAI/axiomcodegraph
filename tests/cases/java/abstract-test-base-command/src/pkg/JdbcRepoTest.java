package pkg;

public class JdbcRepoTest extends AbstractRepoContractTest {
    @Override
    protected Repo repo() {
        return new Repo();
    }
}

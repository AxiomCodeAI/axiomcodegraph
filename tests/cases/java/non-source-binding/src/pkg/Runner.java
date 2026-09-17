package pkg;
public class Runner {
    private PersonMapper mapper;
    public String go(String id) { return mapper.getPerson(id); }
}

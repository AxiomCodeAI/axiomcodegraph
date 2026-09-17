package pkg;
public class Token {
    public enum Type { StartTag, EndTag, Comment, Character, Doctype, EOF }
    public Type type;
    public String name(Token token) {
        switch (token.type) {
            case StartTag: return "s";
            case EndTag: return "e";
            case Comment: return "c";
            case Character: return "h";
            case Doctype: return "d";
            case EOF: return "f";
        }
        return "";
    }
}

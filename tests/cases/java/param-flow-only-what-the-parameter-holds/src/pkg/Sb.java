package pkg;

// implements an unstaged interface, extends nothing unstaged: never a StringBuffer
public class Sb implements CharSequence {
    public int length() { return 0; }
    public char charAt(int i) { return 0; }
    public CharSequence subSequence(int a, int b) { return this; }
    public void getChars(int a, int b, char[] dst, int at) { }

    public Sb add(StringBuffer s) { s.getChars(0, s.length(), new char[0], 0); return this; }
    public Sb add(Sb other) { other.getChars(0, 0, new char[0], 0); return this; }
    public Sb use(Sb x) { return add(x); }
}

namespace App;

public static class Calc
{
    public static int Area(int w, int h) => w * h;
    public static int Perimeter(int w, int h) => 2 * (w + h);
    public static int Scale(int q) => q * 3;
    public static int Unused(int q) => q - 1;
    public static int Open(int q) => q + 10;
    public static int Orphan(int q) => q + 11;
    public static int Shared(int q) => q + 12;
    public static int External(int q) => q + 13;
    public static int Local(int q) => q + 14;
    public static int Close(int q) => q + 15;
    public static int Host(int q) => q + 16;
    public static int Helped(int q) => q + 17;
}

public class Main {

    public static long gcd(long a, long b) {
        while (b != 0) {
            long temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    public static long lcm(long a, long b) {
        if (a == 0 || b == 0) {
            return 0;
        }
        return (a / gcd(a, b)) * b;
    }

    public static void main(String[] args) {
        long[][] pairs = {
            {12, 18},
            {7, 13},
            {100, 75}
        };
        for (long[] pair : pairs) {
            long a = pair[0];
            long b = pair[1];
            System.out.println(gcd(a, b) + " " + lcm(a, b));
        }
    }
}
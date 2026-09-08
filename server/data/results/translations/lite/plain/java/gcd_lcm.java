public class Writing {
    public static int gcd(int a, int b) {
        while (b != 0) {
            int temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    public static int lcm(int a, int b) {
        if (a == 0 || b == 0) {
            return 0;
        }
        return a / gcd(a, b) * b;
    }

    public static void main(String[] args) {
        int[][] pairs = {
            {12, 18},
            {7, 13},
            {100, 75}
        };
        for (int[] pair : pairs) {
            int a = pair[0];
            int b = pair[1];
            System.out.println(gcd(a, b) + " " + lcm(a, b));
        }
    }
}
public class Writing {
    public static int collatz_steps(int n) {
        int steps = 0;
        while (n != 1) {
            if (n % 2 == 0) {
                n = n / 2;
            } else {
                n = 3 * n + 1;
            }
            steps = steps + 1;
        }
        return steps;
    }

    public static void main(String[] args) {
        for (int start : new int[]{6, 7, 27, 1}) {
            System.out.println(collatz_steps(start));
        }
    }
}
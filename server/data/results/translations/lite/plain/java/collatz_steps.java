public class Writing {

    public static int collatzSteps(int n) {
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
        int[] starts = {6, 7, 27, 1};
        for (int start : starts) {
            System.out.println(collatzSteps(start));
        }
    }
}
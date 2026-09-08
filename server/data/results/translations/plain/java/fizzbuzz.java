public class Main {

    public static String classify(int n) {
        if (n % 15 == 0) {
            return "FizzBuzz";
        } else if (n % 3 == 0) {
            return "Fizz";
        } else if (n % 5 == 0) {
            return "Buzz";
        } else {
            return String.valueOf(n);
        }
    }

    public static void main(String[] args) {
        for (int i = 1; i < 21; i++) {
            System.out.println(classify(i));
        }
    }
}
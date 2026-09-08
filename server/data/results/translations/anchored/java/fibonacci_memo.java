import java.util.HashMap;
import java.util.Map;

public class Main {

    public static int fib(int n, Map<Integer, Integer> memo) {
        if (n <= 1) {
            return n;
        }
        if (memo.containsKey(n)) {
            return memo.get(n);
        }
        int value = fib(n - 1, memo) + fib(n - 2, memo);
        memo.put(n, value);
        return value;
    }

    public static void main(String[] args) {
        Map<Integer, Integer> memo = new HashMap<>();
        for (int i = 0; i < 15; i++) {
            System.out.println(fib(i, memo));
        }
    }
}
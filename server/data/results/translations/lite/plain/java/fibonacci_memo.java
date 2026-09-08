import java.util.HashMap;
import java.util.Map;

public class Main {
    public static long fib(int n, Map<Integer, Long> memo) {
        if (n <= 1) {
            return n;
        }
        if (memo.containsKey(n)) {
            return memo.get(n);
        }
        long value = fib(n - 1, memo) + fib(n - 2, memo);
        memo.put(n, value);
        return value;
    }

    public static void main(String[] args) {
        Map<Integer, Long> memo = new HashMap<>();
        for (int i = 0; i < 15; i++) {
            System.out.println(fib(i, memo));
        }
    }
}
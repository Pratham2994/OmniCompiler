import java.util.ArrayList;
import java.util.List;

public class Main {

    public static List<Integer> sieve(int limit) {
        boolean[] flags = new boolean[limit + 1];
        for (int i = 0; i <= limit; i++) {
            flags[i] = true;
        }
        flags[0] = false;
        if (limit >= 1) {
            flags[1] = false;
        }
        int i = 2;
        while (i * i <= limit) {
            if (flags[i]) {
                int j = i * i;
                while (j <= limit) {
                    flags[j] = false;
                    j = j + i;
                }
            }
            i = i + 1;
        }
        List<Integer> primes = new ArrayList<>();
        for (int k = 0; k <= limit; k++) {
            if (flags[k]) {
                primes.add(k);
            }
        }
        return primes;
    }

    public static void main(String[] args) {
        List<Integer> result = sieve(50);
        String line = "";
        for (int value : result) {
            line = line + value + " ";
        }
        System.out.println(line.trim());
    }
}
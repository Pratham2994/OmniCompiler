import java.util.ArrayList;
import java.util.List;

public class Writing {

    public static List<Integer> sieve(int limit) {
        List<Boolean> flags = new ArrayList<>();
        for (int i = 0; i <= limit; i++) {
            flags.add(true);
        }
        flags.set(0, false);
        if (limit >= 1) {
            flags.set(1, false);
        }
        int i = 2;
        while (i * i <= limit) {
            if (flags.get(i)) {
                int j = i * i;
                while (j <= limit) {
                    flags.set(j, false);
                    j = j + i;
                }
            }
            i = i + 1;
        }
        List<Integer> primes = new ArrayList<>();
        for (int k = 0; k <= limit; k++) {
            if (flags.get(k)) {
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
        System.out.println(line.strip());
    }
}
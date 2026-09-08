import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Main {

    public static Map<String, Integer> word_frequency(String text) {
        Map<String, Integer> counts = new HashMap<>();
        String word = "";
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == ' ') {
                if (word.length() > 0) {
                    if (counts.containsKey(word)) {
                        counts.put(word, counts.get(word) + 1);
                    } else {
                        counts.put(word, 1);
                    }
                    word = "";
                }
            } else {
                word = word + ch;
            }
        }
        if (word.length() > 0) {
            if (counts.containsKey(word)) {
                counts.put(word, counts.get(word) + 1);
            } else {
                counts.put(word, 1);
            }
        }
        return counts;
    }

    public static void main(String[] args) {
        String text = "the quick the lazy the quick fox";
        Map<String, Integer> counts = word_frequency(text);
        List<String> keys = new ArrayList<>(counts.keySet());
        Collections.sort(keys);
        for (String key : keys) {
            System.out.println(key + " " + counts.get(key));
        }
    }
}
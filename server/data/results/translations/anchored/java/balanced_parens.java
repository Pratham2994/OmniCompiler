import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;

public class Main {

    public static boolean is_balanced(String text) {
        Deque<Character> stack = new ArrayDeque<>();
        Map<Character, Character> pairs = new HashMap<>();
        pairs.put(')', '(');
        pairs.put(']', '[');
        pairs.put('}', '{');

        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '(' || ch == '[' || ch == '{') {
                stack.push(ch);
            } else if (pairs.containsKey(ch)) {
                if (stack.isEmpty()) {
                    return false;
                }
                char top = stack.pop();
                if (top != pairs.get(ch)) {
                    return false;
                }
            }
        }
        return stack.isEmpty();
    }

    public static void main(String[] args) {
        String[] samples = {"()", "([{}])", "(]", "((()", "{[()]}"};
        for (String sample : samples) {
            if (is_balanced(sample)) {
                System.out.println("true");
            } else {
                System.out.println("false");
            }
        }
    }
}
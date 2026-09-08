public class Writing {

    public static String encode(String text) {
        if (text.length() == 0) {
            return "";
        }
        String result = "";
        char current = text.charAt(0);
        int count = 1;
        int i = 1;
        while (i < text.length()) {
            if (text.charAt(i) == current) {
                count = count + 1;
            } else {
                result = result + current + Integer.toString(count);
                current = text.charAt(i);
                count = 1;
            }
            i = i + 1;
        }
        result = result + current + Integer.toString(count);
        return result;
    }

    public static void main(String[] args) {
        String[] samples = {"aaabbc", "abcd", "zzzzzzzz"};
        for (String sample : samples) {
            System.out.println(encode(sample));
        }
    }
}
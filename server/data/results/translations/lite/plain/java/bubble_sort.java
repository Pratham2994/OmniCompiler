import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class Writing {

    public static List<Integer> bubble_sort(List<Integer> values) {
        List<Integer> items = new ArrayList<>(values);
        int n = items.size();
        for (int i = 0; i < n; i++) {
            boolean swapped = false;
            for (int j = 0; j < n - i - 1; j++) {
                if (items.get(j).compareTo(items.get(j + 1)) > 0) {
                    int temp = items.get(j);
                    items.set(j, items.get(j + 1));
                    items.set(j + 1, temp);
                    swapped = true;
                }
            }
            if (!swapped) {
                break;
            }
        }
        return items;
    }

    public static void main(String[] args) {
        List<Integer> data = Arrays.asList(5, 2, 9, 1, 5, 6);
        List<Integer> result = bubble_sort(data);
        StringBuilder line = new StringBuilder();
        for (Integer value : result) {
            line.append(value).append(" ");
        }
        System.out.println(line.toString().trim());
    }
}
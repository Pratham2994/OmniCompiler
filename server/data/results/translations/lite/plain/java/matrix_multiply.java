import java.util.ArrayList;
import java.util.List;

public class Writing {

    public static List<List<Integer>> multiply(List<List<Integer>> a, List<List<Integer>> b) {
        int rows = a.size();
        int inner = b.size();
        int cols = b.get(0).size();
        List<List<Integer>> result = new ArrayList<>();
        for (int i = 0; i < rows; i++) {
            List<Integer> row = new ArrayList<>();
            for (int j = 0; j < cols; j++) {
                int total = 0;
                for (int k = 0; k < inner; k++) {
                    total = total + a.get(i).get(k) * b.get(k).get(j);
                }
                row.add(total);
            }
            result.add(row);
        }
        return result;
    }

    public static void main(String[] args) {
        List<List<Integer>> a = new ArrayList<>();
        a.add(new ArrayList<>(List.of(1, 2)));
        a.add(new ArrayList<>(List.of(3, 4)));

        List<List<Integer>> b = new ArrayList<>();
        b.add(new ArrayList<>(List.of(5, 6)));
        b.add(new ArrayList<>(List.of(7, 8)));

        List<List<Integer>> product = multiply(a, b);
        for (List<Integer> row : product) {
            String line = "";
            for (int value : row) {
                line = line + value + " ";
            }
            System.out.println(line.strip());
        }
    }
}
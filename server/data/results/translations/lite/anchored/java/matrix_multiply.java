import java.util.ArrayList;
import java.util.List;

public class MatrixMultiply {

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
        List<Integer> a1 = new ArrayList<>();
        a1.add(1);
        a1.add(2);
        a.add(a1);
        List<Integer> a2 = new ArrayList<>();
        a2.add(3);
        a2.add(4);
        a.add(a2);

        List<List<Integer>> b = new ArrayList<>();
        List<Integer> b1 = new ArrayList<>();
        b1.add(5);
        b1.add(6);
        b.add(b1);
        List<Integer> b2 = new ArrayList<>();
        b2.add(7);
        b2.add(8);
        b.add(b2);

        List<List<Integer>> product = multiply(a, b);
        for (List<Integer> row : product) {
            String line = "";
            for (Integer value : row) {
                line = line + String.valueOf(value) + " ";
            }
            System.out.println(line.trim());
        }
    }
}
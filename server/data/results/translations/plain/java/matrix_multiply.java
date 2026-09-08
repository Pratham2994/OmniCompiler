public class Main {
    public static int[][] multiply(int[][] a, int[][] b) {
        int rows = a.length;
        int inner = b.length;
        int cols = b[0].length;
        int[][] result = new int[rows][cols];
        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                int total = 0;
                for (int k = 0; k < inner; k++) {
                    total = total + a[i][k] * b[k][j];
                }
                result[i][j] = total;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[][] a = {{1, 2}, {3, 4}};
        int[][] b = {{5, 6}, {7, 8}};
        int[][] product = multiply(a, b);
        for (int[] row : product) {
            String line = "";
            for (int value : row) {
                line = line + value + " ";
            }
            System.out.println(line.trim());
        }
    }
}
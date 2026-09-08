public class Writing {

    public static int binary_search(int[] values, int target) {
        int low = 0;
        int high = values.length - 1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (values[mid] == target) {
                return mid;
            } else if (values[mid] < target) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] data = {1, 3, 5, 7, 9, 11, 13};
        int[] targets = {1, 7, 13, 4};
        for (int target : targets) {
            System.out.println(binary_search(data, target));
        }
    }
}
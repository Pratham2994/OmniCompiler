import java.util.HashMap;
import java.util.Map;

public class Writing {

    public static int[] two_sum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (seen.containsKey(complement)) {
                return new int[] { seen.get(complement), i };
            } else {
                seen.put(nums[i], i);
            }
        }
        return new int[] { -1, -1 };
    }

    public static void main(String[] args) {
        Object[][] cases = {
            { new int[] { 2, 7, 11, 15 }, 9 },
            { new int[] { 3, 2, 4 }, 6 },
            { new int[] { 1, 2, 3 }, 100 }
        };

        for (Object[] c : cases) {
            int[] nums = (int[]) c[0];
            int target = (int) c[1];
            int[] pair = two_sum(nums, target);
            System.out.println(pair[0] + " " + pair[1]);
        }
    }
}
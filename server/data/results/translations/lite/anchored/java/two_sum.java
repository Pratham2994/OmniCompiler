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
        int[][] casesNums = {
            {2, 7, 11, 15},
            {3, 2, 4},
            {1, 2, 3}
        };
        int[] casesTargets = {9, 6, 100};
        
        for (int i = 0; i < casesNums.length; i++) {
            int[] nums = casesNums[i];
            int target = casesTargets[i];
            int[] pair = two_sum(nums, target);
            System.out.println(pair[0] + " " + pair[1]);
        }
    }
}
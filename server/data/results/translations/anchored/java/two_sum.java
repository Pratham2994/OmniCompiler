import java.util.HashMap;
import java.util.Map;

public class Main {

    public static int[] two_sum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (seen.containsKey(complement)) {
                return new int[]{seen.get(complement), i};
            } else {
                seen.put(nums[i], i);
            }
        }
        return new int[]{-1, -1};
    }

    static class TestCase {
        int[] nums;
        int target;

        TestCase(int[] nums, int target) {
            this.nums = nums;
            this.target = target;
        }
    }

    public static void main(String[] args) {
        TestCase[] cases = new TestCase[]{
            new TestCase(new int[]{2, 7, 11, 15}, 9),
            new TestCase(new int[]{3, 2, 4}, 6),
            new TestCase(new int[]{1, 2, 3}, 100)
        };

        for (TestCase c : cases) {
            int[] pair = two_sum(c.nums, c.target);
            System.out.println(pair[0] + " " + pair[1]);
        }
    }
}
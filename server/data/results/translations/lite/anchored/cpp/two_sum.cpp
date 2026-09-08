#include <iostream>
#include <vector>
#include <unordered_map>
#include <utility>

std::vector<int> two_sum(const std::vector<int>& nums, int target) {
    std::unordered_map<int, int> seen;
    for (size_t i = 0; i < nums.size(); ++i) {
        int complement = target - nums[i];
        if (seen.find(complement) != seen.end()) {
            return {seen[complement], static_cast<int>(i)};
        } else {
            seen[nums[i]] = static_cast<int>(i);
        }
    }
    return {-1, -1};
}

void main_func() {
    std::vector<std::pair<std::vector<int>, int>> cases = {
        {{2, 7, 11, 15}, 9},
        {{3, 2, 4}, 6},
        {{1, 2, 3}, 100}
    };
    for (const auto& item : cases) {
        const std::vector<int>& nums = item.first;
        int target = item.second;
        std::vector<int> pair = two_sum(nums, target);
        std::cout << std::to_string(pair[0]) + " " + std::to_string(pair[1]) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
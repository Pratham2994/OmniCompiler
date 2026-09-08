#include <iostream>
#include <vector>

int binary_search(const std::vector<int>& values, int target) {
    int low = 0;
    int high = static_cast<int>(values.size()) - 1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
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

void main_func() {
    std::vector<int> data = {1, 3, 5, 7, 9, 11, 13};
    std::vector<int> targets = {1, 7, 13, 4};
    for (int target : targets) {
        std::cout << binary_search(data, target) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
#include <iostream>
#include <vector>
#include <string>

std::vector<int> bubble_sort(const std::vector<int>& values) {
    std::vector<int> items = values;
    int n = items.size();
    for (int i = 0; i < n; ++i) {
        bool swapped = false;
        for (int j = 0; j < n - i - 1; ++j) {
            if (items[j] > items[j + 1]) {
                int temp = items[j];
                items[j] = items[j + 1];
                items[j + 1] = temp;
                swapped = true;
            }
        }
        if (!swapped) {
            break;
        }
    }
    return items;
}

int main() {
    std::vector<int> data = {5, 2, 9, 1, 5, 6};
    std::vector<int> result = bubble_sort(data);
    std::string line = "";
    for (int value : result) {
        line = line + std::to_string(value) + " ";
    }
    size_t start = line.find_first_not_of(" \t\n\r");
    if (start != std::string::npos) {
        size_t end = line.find_last_not_of(" \t\n\r");
        line = line.substr(start, end - start + 1);
    } else {
        line = "";
    }
    std::cout << line << std::endl;
    return 0;
}
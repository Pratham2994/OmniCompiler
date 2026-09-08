#include <iostream>
#include <vector>
#include <string>
#include <sstream>

std::vector<std::vector<int>> multiply(const std::vector<std::vector<int>>& a, const std::vector<std::vector<int>>& b) {
    int rows = a.size();
    int inner = b.size();
    int cols = b[0].size();
    std::vector<std::vector<int>> result;
    for (int i = 0; i < rows; ++i) {
        std::vector<int> row;
        for (int j = 0; j < cols; ++j) {
            int total = 0;
            for (int k = 0; k < inner; ++k) {
                total = total + a[i][k] * b[k][j];
            }
            row.push_back(total);
        }
        result.push_back(row);
    }
    return result;
}

void main_func() {
    std::vector<std::vector<int>> a = {{1, 2}, {3, 4}};
    std::vector<std::vector<int>> b = {{5, 6}, {7, 8}};
    std::vector<std::vector<int>> product = multiply(a, b);
    for (const auto& row : product) {
        std::string line = "";
        for (int value : row) {
            line = line + std::to_string(value) + " ";
        }
        // strip() equivalent: remove trailing space if line is not empty
        if (!line.empty() && line.back() == ' ') {
            line.pop_back();
        }
        std::cout << line << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
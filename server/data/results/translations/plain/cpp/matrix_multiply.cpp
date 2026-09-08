#include <iostream>
#include <vector>
#include <string>

std::vector<std::vector<int>> multiply(const std::vector<std::vector<int>>& a, const std::vector<std::vector<int>>& b) {
    size_t rows = a.size();
    size_t inner = b.size();
    size_t cols = b[0].size();
    std::vector<std::vector<int>> result;
    for (size_t i = 0; i < rows; ++i) {
        std::vector<int> row;
        for (size_t j = 0; j < cols; ++j) {
            int total = 0;
            for (size_t k = 0; k < inner; ++k) {
                total = total + a[i][k] * b[k][j];
            }
            row.push_back(total);
        }
        result.push_back(row);
    }
    return result;
}

int main() {
    std::vector<std::vector<int>> a = {{1, 2}, {3, 4}};
    std::vector<std::vector<int>> b = {{5, 6}, {7, 8}};
    std::vector<std::vector<int>> product = multiply(a, b);
    for (const auto& row : product) {
        std::string line = "";
        for (int value : row) {
            line = line + std::to_string(value) + " ";
        }
        size_t start = line.find_first_not_of(" \t\n\r");
        size_t end = line.find_last_not_of(" \t\n\r");
        if (start == std::string::npos) {
            line = "";
        } else {
            line = line.substr(start, end - start + 1);
        }
        std::cout << line << std::endl;
    }
    return 0;
}
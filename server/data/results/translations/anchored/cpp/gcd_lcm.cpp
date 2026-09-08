#include <iostream>
#include <vector>
#include <utility>

int gcd(int a, int b) {
    while (b != 0) {
        int temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}

int lcm(int a, int b) {
    if (a == 0 || b == 0) {
        return 0;
    }
    return a / gcd(a, b) * b;
}

int main() {
    std::vector<std::pair<int, int>> pairs = {{12, 18}, {7, 13}, {100, 75}};
    for (const auto& [a, b] : pairs) {
        std::cout << gcd(a, b) << " " << lcm(a, b) << std::endl;
    }
    return 0;
}
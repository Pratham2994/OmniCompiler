#include <iostream>
#include <vector>
#include <utility>
#include <string>

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
    return (a / gcd(a, b)) * b;
}

void main_func() {
    std::vector<std::pair<int, int>> pairs = {{12, 18}, {7, 13}, {100, 75}};
    for (const auto& pair : pairs) {
        int a = pair.first;
        int b = pair.second;
        std::cout << std::to_string(gcd(a, b)) + " " + std::to_string(lcm(a, b)) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
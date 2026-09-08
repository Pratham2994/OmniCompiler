#include <iostream>
#include <unordered_map>

int fib(int n, std::unordered_map<int, int>& memo) {
    if (n <= 1) {
        return n;
    }
    if (memo.find(n) != memo.end()) {
        return memo[n];
    }
    int value = fib(n - 1, memo) + fib(n - 2, memo);
    memo[n] = value;
    return value;
}

int main() {
    std::unordered_map<int, int> memo;
    for (int i = 0; i < 15; ++i) {
        std::cout << fib(i, memo) << std::endl;
    }
    return 0;
}
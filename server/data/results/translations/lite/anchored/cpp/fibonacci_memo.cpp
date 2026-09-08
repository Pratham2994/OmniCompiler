#include <iostream>
#include <unordered_map>

long long fib(int n, std::unordered_map<int, long long>& memo) {
    if (n <= 1) {
        return n;
    }
    if (memo.find(n) != memo.end()) {
        return memo[n];
    }
    long long value = fib(n - 1, memo) + fib(n - 2, memo);
    memo[n] = value;
    return value;
}

void main_func() {
    std::unordered_map<int, long long> memo;
    for (int i = 0; i < 15; ++i) {
        std::cout << fib(i, memo) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
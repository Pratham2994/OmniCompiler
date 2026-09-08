#include <iostream>
#include <unordered_map>

long long fib(int n, std::unordered_map<int, long long>& memo) {
    if (n <= 1) {
        return n;
    }
    auto it = memo.find(n);
    if (it != memo.end()) {
        return it->second;
    }
    long long value = fib(n - 1, memo) + fib(n - 2, memo);
    memo[n] = value;
    return value;
}

int main() {
    std::unordered_map<int, long long> memo;
    for (int i = 0; i < 15; ++i) {
        std::cout << fib(i, memo) << std::endl;
    }
    return 0;
}
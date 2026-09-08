#include <iostream>
#include <vector>

int collatz_steps(long long n) {
    int steps = 0;
    while (n != 1) {
        if (n % 2 == 0) {
            n = n / 2;
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    return steps;
}

void main_func() {
    std::vector<long long> starts = {6, 7, 27, 1};
    for (long long start : starts) {
        std::cout << collatz_steps(start) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
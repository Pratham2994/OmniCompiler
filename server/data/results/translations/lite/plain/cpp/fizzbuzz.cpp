#include <iostream>
#include <string>

std::string classify(int n) {
    if (n % 15 == 0) {
        return "FizzBuzz";
    } else if (n % 3 == 0) {
        return "Fizz";
    } else if (n % 5 == 0) {
        return "Buzz";
    } else {
        return std::to_string(n);
    }
}

void main_func() {
    for (int i = 1; i <= 20; ++i) {
        std::cout << classify(i) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
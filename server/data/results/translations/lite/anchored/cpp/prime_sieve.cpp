#include <iostream>
#include <vector>
#include <string>

std::vector<int> sieve(int limit) {
    std::vector<bool> flags;
    for (int i = 0; i <= limit; ++i) {
        flags.push_back(true);
    }
    flags[0] = false;
    if (limit >= 1) {
        flags[1] = false;
    }
    int i = 2;
    while (i * i <= limit) {
        if (flags[i]) {
            int j = i * i;
            while (j <= limit) {
                flags[j] = false;
                j = j + i;
            }
        }
        i = i + 1;
    }
    std::vector<int> primes;
    for (int k = 0; k <= limit; ++k) {
        if (flags[k]) {
            primes.push_back(k);
        }
    }
    return primes;
}

void main_func() {
    std::vector<int> result = sieve(50);
    std::string line = "";
    for (int value : result) {
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

int main() {
    main_func();
    return 0;
}
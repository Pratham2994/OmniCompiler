#include <iostream>
#include <string>
#include <vector>

std::string encode(const std::string& text) {
    if (text.length() == 0) {
        return "";
    }
    std::string result = "";
    char current = text[0];
    int count = 1;
    size_t i = 1;
    while (i < text.length()) {
        if (text[i] == current) {
            count = count + 1;
        } else {
            result = result + current + std::to_string(count);
            current = text[i];
            count = 1;
        }
        i = i + 1;
    }
    result = result + current + std::to_string(count);
    return result;
}

void main_func() {
    std::vector<std::string> samples = {"aaabbc", "abcd", "zzzzzzzz"};
    for (const std::string& sample : samples) {
        std::cout << encode(sample) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
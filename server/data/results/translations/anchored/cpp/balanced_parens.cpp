#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>

bool is_balanced(const std::string& text) {
    std::vector<char> stack;
    std::unordered_map<char, char> pairs = {
        {')', '('},
        {']', '['},
        {'}', '{'}
    };
    for (char ch : text) {
        if (ch == '(' || ch == '[' || ch == '{') {
            stack.push_back(ch);
        } else if (pairs.find(ch) != pairs.end()) {
            if (stack.empty()) {
                return false;
            }
            char top = stack.back();
            stack.pop_back();
            if (top != pairs[ch]) {
                return false;
            }
        }
    }
    return stack.empty();
}

int main() {
    std::vector<std::string> samples = {"()", "([{}])", "(]", "((()", "{[()]}"};
    for (const auto& sample : samples) {
        if (is_balanced(sample)) {
            std::cout << "true\n";
        } else {
            std::cout << "false\n";
        }
    }
    return 0;
}
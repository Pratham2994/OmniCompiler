#include <iostream>
#include <string>
#include <vector>
#include <stack>
#include <unordered_map>

bool is_balanced(const std::string& text) {
    std::stack<char> stack;
    std::unordered_map<char, char> pairs = {{')', '('}, {']', '['}, {'}', '{'}};
    for (char ch : text) {
        if (ch == '(' || ch == '[' || ch == '{') {
            stack.push(ch);
        } else if (pairs.find(ch) != pairs.end()) {
            if (stack.empty()) {
                return false;
            }
            char top = stack.top();
            stack.pop();
            if (top != pairs[ch]) {
                return false;
            }
        }
    }
    return stack.empty();
}

void main_func() {
    std::vector<std::string> samples = {"()", "([{}])", "(]", "((()", "{[()]}="};
    for (const std::string& sample : samples) {
        if (is_balanced(sample)) {
            std::cout << "true" << std::endl;
        } else {
            std::cout << "false" << std::endl;
        }
    }
}

int main() {
    main_func();
    return 0;
}
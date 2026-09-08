#include <iostream>
#include <string>
#include <map>
#include <vector>
#include <algorithm>

std::map<std::string, int> word_frequency(const std::string& text) {
    std::map<std::string, int> counts;
    std::string word = "";
    for (char ch : text) {
        if (ch == ' ') {
            if (word.length() > 0) {
                if (counts.find(word) != counts.end()) {
                    counts[word] = counts[word] + 1;
                } else {
                    counts[word] = 1;
                }
                word = "";
            }
        } else {
            word = word + ch;
        }
    }
    if (word.length() > 0) {
        if (counts.find(word) != counts.end()) {
            counts[word] = counts[word] + 1;
        } else {
            counts[word] = 1;
        }
    }
    return counts;
}

void main_func() {
    std::string text = "the quick the lazy the quick fox";
    std::map<std::string, int> counts = word_frequency(text);
    std::vector<std::string> keys;
    for (auto const& element : counts) {
        keys.push_back(element.first);
    }
    std::sort(keys.begin(), keys.end());
    for (const std::string& key : keys) {
        std::cout << key + " " + std::to_string(counts[key]) << std::endl;
    }
}

int main() {
    main_func();
    return 0;
}
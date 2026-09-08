#include <iostream>
#include <string>
#include <unordered_map>
#include <map>
#include <vector>
#include <algorithm>

std::unordered_map<std::string, int> word_frequency(const std::string& text) {
    std::unordered_map<std::string, int> counts;
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
    std::unordered_map<std::string, int> counts = word_frequency(text);
    
    std::vector<std::string> keys;
    for (const auto& pair : counts) {
        keys.push_back(pair.first);
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
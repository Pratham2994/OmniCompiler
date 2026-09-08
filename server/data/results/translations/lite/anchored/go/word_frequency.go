package main

import (
	"fmt"
	"sort"
)

func word_frequency(text string) map[string]int {
	counts := make(map[string]int)
	word := ""
	for _, chRunes := range text {
		ch := string(chRunes)
		if ch == " " {
			if len(word) > 0 {
				if _, exists := counts[word]; exists {
					counts[word] = counts[word] + 1
				} else {
					counts[word] = 1
				}
				word = ""
			}
		} else {
			word = word + ch
		}
	}
	if len(word) > 0 {
		if _, exists := counts[word]; exists {
			counts[word] = counts[word] + 1
		} else {
			counts[word] = 1
		}
	}
	return counts
}

func main() {
	text := "the quick the lazy the quick fox"
	counts := word_frequency(text)
	keys := make([]string, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Println(key + " " + fmt.Sprint(counts[key]))
	}
}
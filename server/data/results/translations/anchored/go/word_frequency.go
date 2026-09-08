package main

import (
	"fmt"
	"sort"
	"strconv"
)

func word_frequency(text string) map[string]int {
	counts := make(map[string]int)
	word := ""
	for _, ch := range text {
		if ch == ' ' {
			if len(word) > 0 {
				if _, ok := counts[word]; ok {
					counts[word] = counts[word] + 1
				} else {
					counts[word] = 1
				}
				word = ""
			}
		} else {
			word = word + string(ch)
		}
	}
	if len(word) > 0 {
		if _, ok := counts[word]; ok {
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
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		fmt.Println(key + " " + strconv.Itoa(counts[key]))
	}
}
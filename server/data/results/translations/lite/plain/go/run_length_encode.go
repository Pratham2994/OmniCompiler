package main

import (
	"fmt"
	"strconv"
)

func encode(text string) string {
	if len(text) == 0 {
		return ""
	}
	result := ""
	current := rune(text[0])
	count := 1
	i := 1
	for i < len(text) {
		if rune(text[i]) == current {
			count = count + 1
		} else {
			result = result + string(current) + strconv.Itoa(count)
			current = rune(text[i])
			count = 1
		}
		i = i + 1
	}
	result = result + string(current) + strconv.Itoa(count)
	return result
}

func main() {
	samples := []string{"aaabbc", "abcd", "zzzzzzzz"}
	for _, sample := range samples {
		fmt.Println(encode(sample))
	}
}
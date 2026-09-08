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
	current := string(text[0])
	count := 1
	i := 1
	for i < len(text) {
		if string(text[i]) == current {
			count = count + 1
		} else {
			result = result + current + strconv.Itoa(count)
			current = string(text[i])
			count = 1
		}
		i = i + 1
	}
	result = result + current + strconv.Itoa(count)
	return result
}

func main() {
	samples := []string{"aaabbc", "abcd", "zzzzzzzz"}
	for _, sample := range samples {
		fmt.Println(encode(sample))
	}
}
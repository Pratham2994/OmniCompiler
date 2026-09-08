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
	current := text[0]
	count := 1
	i := 1
	for i < len(text) {
		if text[i] == current {
			count = count + 1
		} else {
			result = result + string(current) + strconv.Itoa(count)
			current = text[i]
			count = 1
		}
		i = i + 1
	}
	result = result + string(current) + strconv.Itoa(count)
	return result
}

func main() {
	for _, sample := range []string{"aaabbc", "abcd", "zzzzzzzz"} {
		fmt.Println(encode(sample))
	}
}
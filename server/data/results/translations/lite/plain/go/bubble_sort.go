package main

import (
	"fmt"
	"strings"
)

func bubble_sort(values []int) []int {
	items := make([]int, len(values))
	copy(items, values)
	n := len(items)
	for i := 0; i < n; i++ {
		swapped := false
		for j := 0; j < n-i-1; j++ {
			if items[j] > items[j+1] {
				temp := items[j]
				items[j] = items[j+1]
				items[j+1] = temp
				swapped = true
			}
		}
		if !swapped {
			break
		}
	}
	return items
}

func main() {
	data := []int{5, 2, 9, 1, 5, 6}
	result := bubble_sort(data)
	line := ""
	for _, value := range result {
		line = line + fmt.Sprintf("%d", value) + " "
	}
	fmt.Println(strings.TrimSpace(line))
}
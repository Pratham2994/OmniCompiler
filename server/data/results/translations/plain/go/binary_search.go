package main

import "fmt"

func binarySearch(values []int, target int) int {
	low := 0
	high := len(values) - 1
	for low <= high {
		mid := (low + high) / 2
		if values[mid] == target {
			return mid
		} else if values[mid] < target {
			low = mid + 1
		} else {
			high = mid - 1
		}
	}
	return -1
}

func main() {
	data := []int{1, 3, 5, 7, 9, 11, 13}
	for _, target := range []int{1, 7, 13, 4} {
		fmt.Println(binarySearch(data, target))
	}
}
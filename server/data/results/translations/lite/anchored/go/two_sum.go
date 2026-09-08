package main

import (
	"fmt"
)

func two_sum(nums []int, target int) []int {
	seen := make(map[int]int)
	for i := 0; i < len(nums); i++ {
		complement := target - nums[i]
		if idx, exists := seen[complement]; exists {
			return []int{idx, i}
		} else {
			seen[nums[i]] = i
		}
	}
	return []int{-1, -1}
}

func main() {
	cases := []struct {
		nums   []int
		target int
	}{
		{[]int{2, 7, 11, 15}, 9},
		{[]int{3, 2, 4}, 6},
		{[]int{1, 2, 3}, 100},
	}
	for _, c := range cases {
		pair := two_sum(c.nums, c.target)
		fmt.Println(fmt.Sprintf("%d %d", pair[0], pair[1]))
	}
}
package main

import "fmt"

func twoSum(nums []int, target int) []int {
	seen := make(map[int]int)
	for i := 0; i < len(nums); i++ {
		complement := target - nums[i]
		if j, ok := seen[complement]; ok {
			return []int{j, i}
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
		pair := twoSum(c.nums, c.target)
		fmt.Println(fmt.Sprintf("%d %d", pair[0], pair[1]))
	}
}
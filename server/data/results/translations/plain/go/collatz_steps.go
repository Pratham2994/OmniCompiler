package main

import "fmt"

func collatzSteps(n int) int {
	steps := 0
	for n != 1 {
		if n%2 == 0 {
			n = n / 2
		} else {
			n = 3*n + 1
		}
		steps = steps + 1
	}
	return steps
}

func main() {
	for _, start := range []int{6, 7, 27, 1} {
		fmt.Println(collatzSteps(start))
	}
}
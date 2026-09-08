package main

import "fmt"

func fib(n int, memo map[int]int) int {
	if n <= 1 {
		return n
	}
	if value, exists := memo[n]; exists {
		return value
	}
	value := fib(n-1, memo) + fib(n-2, memo)
	memo[n] = value
	return value
}

func main() {
	memo := make(map[int]int)
	for i := 0; i < 15; i++ {
		fmt.Println(fib(i, memo))
	}
}
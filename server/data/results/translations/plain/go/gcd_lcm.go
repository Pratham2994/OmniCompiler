package main

import (
	"fmt"
	"strconv"
)

func gcd(a, b int) int {
	for b != 0 {
		temp := b
		b = a % b
		a = temp
	}
	return a
}

func lcm(a, b int) int {
	if a == 0 || b == 0 {
		return 0
	}
	return a / gcd(a, b) * b
}

func main() {
	pairs := [][2]int{
		{12, 18},
		{7, 13},
		{100, 75},
	}
	for _, p := range pairs {
		a, b := p[0], p[1]
		fmt.Println(strconv.Itoa(gcd(a, b)) + " " + strconv.Itoa(lcm(a, b)))
	}
}
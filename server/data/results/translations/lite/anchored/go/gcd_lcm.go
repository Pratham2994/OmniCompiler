package main

import (
	"fmt"
)

func gcd(a int, b int) int {
	for b != 0 {
		temp := b
		b = a % b
		a = temp
	}
	return a
}

func lcm(a int, b int) int {
	if a == 0 || b == 0 {
		return 0
	}
	return (a / gcd(a, b)) * b
}

func main() {
	pairs := [][2]int{
		{12, 18},
		{7, 13},
		{100, 75},
	}
	for _, pair := range pairs {
		a, b := pair[0], pair[1]
		fmt.Println(fmt.Sprintf("%d", gcd(a, b)) + " " + fmt.Sprintf("%d", lcm(a, b)))
	}
}
package main

import (
	"fmt"
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
	return (a / gcd(a, b)) * b
}

func main() {
	pairs := []struct{ a, b int }{
		{12, 18},
		{7, 13},
		{100, 75},
	}
	for _, p := range pairs {
		a, b := p.a, p.b
		fmt.Printf("%d %d\n", gcd(a, b), lcm(a, b))
	}
}
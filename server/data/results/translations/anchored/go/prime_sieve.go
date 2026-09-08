package main

import (
	"fmt"
	"strconv"
	"strings"
)

func sieve(limit int) []int {
	var flags []bool
	for i := 0; i <= limit; i++ {
		flags = append(flags, true)
	}
	flags[0] = false
	if limit >= 1 {
		flags[1] = false
	}
	i := 2
	for i*i <= limit {
		if flags[i] {
			j := i * i
			for j <= limit {
				flags[j] = false
				j = j + i
			}
		}
		i = i + 1
	}
	var primes []int
	for k := 0; k <= limit; k++ {
		if flags[k] {
			primes = append(primes, k)
		}
	}
	return primes
}

func main() {
	result := sieve(50)
	line := ""
	for _, value := range result {
		line = line + strconv.Itoa(value) + " "
	}
	fmt.Println(strings.TrimSpace(line))
}
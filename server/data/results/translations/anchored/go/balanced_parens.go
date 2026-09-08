package main

import "fmt"

func is_balanced(text string) bool {
	var stack []rune
	pairs := map[rune]rune{
		')': '(',
		']': '[',
		'}': '{',
	}
	for _, ch := range text {
		if ch == '(' || ch == '[' || ch == '{' {
			stack = append(stack, ch)
		} else if opening, ok := pairs[ch]; ok {
			if len(stack) == 0 {
				return false
			}
			top := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if top != opening {
				return false
			}
		}
	}
	return len(stack) == 0
}

func main() {
	samples := []string{"()", "([{}])", "(]", "((()", "{[()]}"}
	for _, sample := range samples {
		if is_balanced(sample) {
			fmt.Println("true")
		} else {
			fmt.Println("false")
		}
	}
}
package main

import (
	"fmt"
	"strings"
)

func multiply(a [][]int, b [][]int) [][]int {
	rows := len(a)
	inner := len(b)
	cols := len(b[0])
	var result [][]int
	for i := 0; i < rows; i++ {
		var row []int
		for j := 0; j < cols; j++ {
			total := 0
			for k := 0; k < inner; k++ {
				total = total + a[i][k]*b[k][j]
			}
			row = append(row, total)
		}
		result = append(result, row)
	}
	return result
}

func main() {
	a := [][]int{{1, 2}, {3, 4}}
	b := [][]int{{5, 6}, {7, 8}}
	product := multiply(a, b)
	for _, row := range product {
		line := ""
		for _, value := range row {
			line = line + fmt.Sprintf("%d", value) + " "
		}
		fmt.Println(strings.TrimSpace(line))
	}
}
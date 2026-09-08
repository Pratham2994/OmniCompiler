"""Equivalent probe programs used to exercise the debugger integrations.

Each language provides three programs with the same shape, so that a
capability observed in one language is compared against the same situation in
the others:

  stepping  - a helper function called from inside a loop, giving a stable
              breakpoint line, a call to step into, a frame to step out of,
              and a local variable to inspect and evaluate.
  stdin     - a program that blocks on standard input, to test whether the
              session surfaces an input request and accepts a reply.
  exception - a program that raises at a known line, to test whether the
              session reports the error as a debugger event rather than only
              as process output.

BREAK_LINE records the line each stepping program should first pause on.
"""

STEPPING = {
    "python": ("main.py", """def add(a, b):
    total = a + b
    return total


def main():
    acc = 0
    for i in range(3):
        acc = add(acc, i)
    print(acc)


main()
""", 9),

    "javascript": ("main.js", """function add(a, b) {
  const total = a + b;
  return total;
}

function main() {
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    acc = add(acc, i);
  }
  console.log(acc);
}

main();
""", 9),

    "java": ("Main.java", """public class Main {
    static int add(int a, int b) {
        int total = a + b;
        return total;
    }

    public static void main(String[] args) {
        int acc = 0;
        for (int i = 0; i < 3; i++) {
            acc = add(acc, i);
        }
        System.out.println(acc);
    }
}
""", 10),

    "cpp": ("main.cpp", """#include <iostream>

int add(int a, int b) {
    int total = a + b;
    return total;
}

int main() {
    int acc = 0;
    for (int i = 0; i < 3; i++) {
        acc = add(acc, i);
    }
    std::cout << acc << std::endl;
    return 0;
}
""", 11),

    "go": ("main.go", """package main

import "fmt"

func add(a int, b int) int {
	total := a + b
	return total
}

func main() {
	acc := 0
	for i := 0; i < 3; i++ {
		acc = add(acc, i)
	}
	fmt.Println(acc)
}
""", 13),
}

STDIN = {
    "python": ("main.py", """name = input()
print("hello " + name)
"""),
    "javascript": ("main.js", """const data = require('fs').readFileSync(0, 'utf-8').trim();
console.log("hello " + data);
"""),
    "java": ("Main.java", """import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.nextLine();
        System.out.println("hello " + name);
    }
}
"""),
    "cpp": ("main.cpp", """#include <iostream>
#include <string>

int main() {
    std::string name;
    std::getline(std::cin, name);
    std::cout << "hello " << name << std::endl;
    return 0;
}
"""),
    "go": ("main.go", """package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	name, _ := reader.ReadString('\\n')
	fmt.Println("hello " + strings.TrimSpace(name))
}
"""),
}

EXCEPTION = {
    "python": ("main.py", """def boom():
    return 1 // 0


print("before")
boom()
"""),
    "javascript": ("main.js", """function boom() {
  throw new Error("boom");
}

console.log("before");
boom();
"""),
    "java": ("Main.java", """public class Main {
    static int boom() {
        return 1 / 0;
    }

    public static void main(String[] args) {
        System.out.println("before");
        boom();
    }
}
"""),
    "cpp": ("main.cpp", """#include <iostream>
#include <stdexcept>

void boom() {
    throw std::runtime_error("boom");
}

int main() {
    std::cout << "before" << std::endl;
    boom();
    return 0;
}
"""),
    "go": ("main.go", """package main

import "fmt"

func boom() {
	var p *int
	fmt.Println(*p)
}

func main() {
	fmt.Println("before")
	boom()
}
"""),
}

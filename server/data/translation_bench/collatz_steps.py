def collatz_steps(n):
    steps = 0
    while n != 1:
        if n % 2 == 0:
            n = n // 2
        else:
            n = 3 * n + 1
        steps = steps + 1
    return steps


def main():
    for start in [6, 7, 27, 1]:
        print(collatz_steps(start))


main()

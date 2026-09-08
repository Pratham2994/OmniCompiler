def fib(n, memo):
    if n <= 1:
        return n
    if n in memo:
        return memo[n]
    value = fib(n - 1, memo) + fib(n - 2, memo)
    memo[n] = value
    return value


def main():
    memo = {}
    for i in range(0, 15):
        print(fib(i, memo))


main()

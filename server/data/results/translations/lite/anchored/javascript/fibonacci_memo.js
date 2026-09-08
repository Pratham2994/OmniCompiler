function fib(n, memo) {
    if (n <= 1) {
        return n;
    }
    if (n in memo) {
        return memo[n];
    }
    let value = fib(n - 1, memo) + fib(n - 2, memo);
    memo[n] = value;
    return value;
}

function main() {
    let memo = {};
    for (let i = 0; i < 15; i++) {
        console.log(fib(i, memo));
    }
}

main();
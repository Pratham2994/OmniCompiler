function collatz_steps(n) {
    let steps = 0;
    while (n !== 1) {
        if (n % 2 === 0) {
            n = Math.floor(n / 2);
        } else {
            n = 3 * n + 1;
        }
        steps = steps + 1;
    }
    return steps;
}

function main() {
    for (const start of [6, 7, 27, 1]) {
        console.log(collatz_steps(start));
    }
}

main();
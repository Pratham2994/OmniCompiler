function gcd(a, b) {
    while (b !== 0) {
        let temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}

function lcm(a, b) {
    if (a === 0 || b === 0) {
        return 0;
    }
    return Math.floor(a / gcd(a, b)) * b;
}

function main() {
    const pairs = [[12, 18], [7, 13], [100, 75]];
    for (const [a, b] of pairs) {
        console.log(String(gcd(a, b)) + " " + String(lcm(a, b)));
    }
}

main();
function sieve(limit) {
    let flags = [];
    for (let i = 0; i <= limit; i++) {
        flags.push(true);
    }
    flags[0] = false;
    if (limit >= 1) {
        flags[1] = false;
    }
    let i = 2;
    while (i * i <= limit) {
        if (flags[i]) {
            let j = i * i;
            while (j <= limit) {
                flags[j] = false;
                j = j + i;
            }
        }
        i = i + 1;
    }
    let primes = [];
    for (let k = 0; k <= limit; k++) {
        if (flags[k]) {
            primes.push(k);
        }
    }
    return primes;
}

function main() {
    let result = sieve(50);
    let line = "";
    for (let value of result) {
        line = line + String(value) + " ";
    }
    console.log(line.trim());
}

main();
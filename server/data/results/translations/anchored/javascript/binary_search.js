function binary_search(values, target) {
    let low = 0;
    let high = values.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (values[mid] === target) {
            return mid;
        } else if (values[mid] < target) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return -1;
}

function main() {
    const data = [1, 3, 5, 7, 9, 11, 13];
    for (const target of [1, 7, 13, 4]) {
        console.log(binary_search(data, target));
    }
}

main();
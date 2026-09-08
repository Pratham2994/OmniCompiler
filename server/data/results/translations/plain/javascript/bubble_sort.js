function bubble_sort(values) {
    const items = Array.from(values);
    const n = items.length;
    for (let i = 0; i < n; i++) {
        let swapped = false;
        for (let j = 0; j < n - i - 1; j++) {
            if (items[j] > items[j + 1]) {
                const temp = items[j];
                items[j] = items[j + 1];
                items[j + 1] = temp;
                swapped = true;
            }
        }
        if (!swapped) {
            break;
        }
    }
    return items;
}


function main() {
    const data = [5, 2, 9, 1, 5, 6];
    const result = bubble_sort(data);
    let line = "";
    for (const value of result) {
        line = line + String(value) + " ";
    }
    console.log(line.trim());
}


main();
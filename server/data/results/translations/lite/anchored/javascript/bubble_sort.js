function bubble_sort(values) {
    let items = Array.from(values);
    let n = items.length;
    for (let i = 0; i < n; i++) {
        let swapped = false;
        for (let j = 0; j < n - i - 1; j++) {
            if (items[j] > items[j + 1]) {
                let temp = items[j];
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
    let data = [5, 2, 9, 1, 5, 6];
    let result = bubble_sort(data);
    let line = "";
    for (let value of result) {
        line = line + String(value) + " ";
    }
    console.log(line.trim());
}

main();
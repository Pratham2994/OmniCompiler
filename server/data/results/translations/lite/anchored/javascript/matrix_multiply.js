function multiply(a, b) {
    let rows = a.length;
    let inner = b.length;
    let cols = b[0].length;
    let result = [];
    for (let i = 0; i < rows; i++) {
        let row = [];
        for (let j = 0; j < cols; j++) {
            let total = 0;
            for (let k = 0; k < inner; k++) {
                total = total + a[i][k] * b[k][j];
            }
            row.push(total);
        }
        result.push(row);
    }
    return result;
}

function main() {
    let a = [[1, 2], [3, 4]];
    let b = [[5, 6], [7, 8]];
    let product = multiply(a, b);
    for (let i = 0; i < product.length; i++) {
        let row = product[i];
        let line = "";
        for (let j = 0; j < row.length; j++) {
            let value = row[j];
            line = line + String(value) + " ";
        }
        console.log(line.trim());
    }
}

main();
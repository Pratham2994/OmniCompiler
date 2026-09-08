function multiply(a, b) {
    const rows = a.length;
    const inner = b.length;
    const cols = b[0].length;
    const result = [];
    for (let i = 0; i < rows; i++) {
        const row = [];
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
    const a = [[1, 2], [3, 4]];
    const b = [[5, 6], [7, 8]];
    const product = multiply(a, b);
    for (const row of product) {
        let line = "";
        for (const value of row) {
            line = line + String(value) + " ";
        }
        console.log(line.trim());
    }
}

main();
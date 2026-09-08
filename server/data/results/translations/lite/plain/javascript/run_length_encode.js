function encode(text) {
    if (text.length === 0) {
        return "";
    }
    let result = "";
    let current = text[0];
    let count = 1;
    let i = 1;
    while (i < text.length) {
        if (text[i] === current) {
            count = count + 1;
        } else {
            result = result + current + String(count);
            current = text[i];
            count = 1;
        }
        i = i + 1;
    }
    result = result + current + String(count);
    return result;
}

function main() {
    const samples = ["aaabbc", "abcd", "zzzzzzzz"];
    for (const sample of samples) {
        console.log(encode(sample));
    }
}

main();
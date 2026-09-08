function is_balanced(text) {
    const stack = [];
    const pairs = {")": "(", "]": "[", "}": "{"};
    for (const ch of text) {
        if (ch === "(" || ch === "[" || ch === "{") {
            stack.push(ch);
        } else if (ch in pairs) {
            if (stack.length === 0) {
                return false;
            }
            const top = stack.pop();
            if (top !== pairs[ch]) {
                return false;
            }
        }
    }
    return stack.length === 0;
}

function main() {
    const samples = ["()", "([{}])", "(]", "((()", "{[()]}"];
    for (const sample of samples) {
        if (is_balanced(sample)) {
            console.log("true");
        } else {
            console.log("false");
        }
    }
}

main();
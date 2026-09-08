function is_balanced(text) {
    let stack = [];
    let pairs = {")": "(", "]": "[", "}": "{"};
    for (let i = 0; i < text.length; i++) {
        let ch = text[i];
        if (ch === "(" || ch === "[" || ch === "{") {
            stack.push(ch);
        } else if (ch in pairs) {
            if (stack.length === 0) {
                return false;
            }
            let top = stack.pop();
            if (top !== pairs[ch]) {
                return false;
            }
        }
    }
    return stack.length === 0;
}

function main() {
    let samples = ["()", "([{}])", "(]", "((()", "{[()]}"];
    for (let i = 0; i < samples.length; i++) {
        let sample = samples[i];
        if (is_balanced(sample)) {
            console.log("true");
        } else {
            console.log("false");
        }
    }
}

main();
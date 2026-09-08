function word_frequency(text) {
    let counts = {};
    let word = "";
    for (let i = 0; i < text.length; i++) {
        let ch = text[i];
        if (ch === " ") {
            if (word.length > 0) {
                if (word in counts) {
                    counts[word] = counts[word] + 1;
                } else {
                    counts[word] = 1;
                }
                word = "";
            }
        } else {
            word = word + ch;
        }
    }
    if (word.length > 0) {
        if (word in counts) {
            counts[word] = counts[word] + 1;
        } else {
            counts[word] = 1;
        }
    }
    return counts;
}

function main() {
    let text = "the quick the lazy the quick fox";
    let counts = word_frequency(text);
    let keys = Object.keys(counts).sort();
    for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        console.log(key + " " + String(counts[key]));
    }
}

main();
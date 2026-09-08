function word_frequency(text) {
    const counts = {};
    let word = "";
    for (const ch of text) {
        if (ch === " ") {
            if (word.length > 0) {
                if (counts.hasOwnProperty(word)) {
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
        if (counts.hasOwnProperty(word)) {
            counts[word] = counts[word] + 1;
        } else {
            counts[word] = 1;
        }
    }
    return counts;
}


function main() {
    const text = "the quick the lazy the quick fox";
    const counts = word_frequency(text);
    const keys = Object.keys(counts).sort();
    for (const key of keys) {
        console.log(key + " " + String(counts[key]));
    }
}


main();
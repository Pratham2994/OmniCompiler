def word_frequency(text):
    counts = {}
    word = ""
    for ch in text:
        if ch == " ":
            if len(word) > 0:
                if word in counts:
                    counts[word] = counts[word] + 1
                else:
                    counts[word] = 1
                word = ""
        else:
            word = word + ch
    if len(word) > 0:
        if word in counts:
            counts[word] = counts[word] + 1
        else:
            counts[word] = 1
    return counts


def main():
    text = "the quick the lazy the quick fox"
    counts = word_frequency(text)
    keys = sorted(counts.keys())
    for key in keys:
        print(key + " " + str(counts[key]))


main()

def encode(text):
    if len(text) == 0:
        return ""
    result = ""
    current = text[0]
    count = 1
    i = 1
    while i < len(text):
        if text[i] == current:
            count = count + 1
        else:
            result = result + current + str(count)
            current = text[i]
            count = 1
        i = i + 1
    result = result + current + str(count)
    return result


def main():
    for sample in ["aaabbc", "abcd", "zzzzzzzz"]:
        print(encode(sample))


main()

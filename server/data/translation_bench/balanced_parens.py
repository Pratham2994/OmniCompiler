def is_balanced(text):
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    for ch in text:
        if ch == "(" or ch == "[" or ch == "{":
            stack.append(ch)
        elif ch in pairs:
            if len(stack) == 0:
                return False
            top = stack.pop()
            if top != pairs[ch]:
                return False
    return len(stack) == 0


def main():
    samples = ["()", "([{}])", "(]", "((()", "{[()]}"]
    for sample in samples:
        if is_balanced(sample):
            print("true")
        else:
            print("false")


main()

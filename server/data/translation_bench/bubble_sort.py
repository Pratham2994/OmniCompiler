def bubble_sort(values):
    items = list(values)
    n = len(items)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if items[j] > items[j + 1]:
                temp = items[j]
                items[j] = items[j + 1]
                items[j + 1] = temp
                swapped = True
        if not swapped:
            break
    return items


def main():
    data = [5, 2, 9, 1, 5, 6]
    result = bubble_sort(data)
    line = ""
    for value in result:
        line = line + str(value) + " "
    print(line.strip())


main()

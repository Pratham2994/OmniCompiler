def binary_search(values, target):
    low = 0
    high = len(values) - 1
    while low <= high:
        mid = (low + high) // 2
        if values[mid] == target:
            return mid
        elif values[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1


def main():
    data = [1, 3, 5, 7, 9, 11, 13]
    for target in [1, 7, 13, 4]:
        print(binary_search(data, target))


main()

def multiply(a, b):
    rows = len(a)
    inner = len(b)
    cols = len(b[0])
    result = []
    for i in range(rows):
        row = []
        for j in range(cols):
            total = 0
            for k in range(inner):
                total = total + a[i][k] * b[k][j]
            row.append(total)
        result.append(row)
    return result


def main():
    a = [[1, 2], [3, 4]]
    b = [[5, 6], [7, 8]]
    product = multiply(a, b)
    for row in product:
        line = ""
        for value in row:
            line = line + str(value) + " "
        print(line.strip())


main()

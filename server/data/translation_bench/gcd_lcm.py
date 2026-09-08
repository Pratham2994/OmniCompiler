def gcd(a, b):
    while b != 0:
        temp = b
        b = a % b
        a = temp
    return a


def lcm(a, b):
    if a == 0 or b == 0:
        return 0
    return a // gcd(a, b) * b


def main():
    pairs = [(12, 18), (7, 13), (100, 75)]
    for a, b in pairs:
        print(str(gcd(a, b)) + " " + str(lcm(a, b)))


main()

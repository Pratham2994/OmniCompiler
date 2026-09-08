def sieve(limit):
    flags = []
    for i in range(limit + 1):
        flags.append(True)
    flags[0] = False
    if limit >= 1:
        flags[1] = False
    i = 2
    while i * i <= limit:
        if flags[i]:
            j = i * i
            while j <= limit:
                flags[j] = False
                j = j + i
        i = i + 1
    primes = []
    for k in range(limit + 1):
        if flags[k]:
            primes.append(k)
    return primes


def main():
    result = sieve(50)
    line = ""
    for value in result:
        line = line + str(value) + " "
    print(line.strip())


main()

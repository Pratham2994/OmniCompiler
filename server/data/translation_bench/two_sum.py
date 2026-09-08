def two_sum(nums, target):
    seen = {}
    for i in range(len(nums)):
        complement = target - nums[i]
        if complement in seen:
            return [seen[complement], i]
        else:
            seen[nums[i]] = i
    return [-1, -1]


def main():
    cases = [([2, 7, 11, 15], 9), ([3, 2, 4], 6), ([1, 2, 3], 100)]
    for nums, target in cases:
        pair = two_sum(nums, target)
        print(str(pair[0]) + " " + str(pair[1]))


main()

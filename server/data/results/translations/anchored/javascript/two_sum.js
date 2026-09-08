function two_sum(nums, target) {
    const seen = {};
    for (let i = 0; i < nums.length; i++) {
        const complement = target - nums[i];
        if (complement in seen) {
            return [seen[complement], i];
        } else {
            seen[nums[i]] = i;
        }
    }
    return [-1, -1];
}


function main() {
    const cases = [
        [[2, 7, 11, 15], 9],
        [[3, 2, 4], 6],
        [[1, 2, 3], 100]
    ];
    for (const [nums, target] of cases) {
        const pair = two_sum(nums, target);
        console.log(String(pair[0]) + " " + String(pair[1]));
    }
}


main();
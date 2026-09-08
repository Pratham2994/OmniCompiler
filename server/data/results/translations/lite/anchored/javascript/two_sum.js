function two_sum(nums, target) {
    let seen = {};
    for (let i = 0; i < nums.length; i++) {
        let complement = target - nums[i];
        if (complement in seen) {
            return [seen[complement], i];
        } else {
            seen[nums[i]] = i;
        }
    }
    return [-1, -1];
}

function main() {
    let cases = [
        [[2, 7, 11, 15], 9],
        [[3, 2, 4], 6],
        [[1, 2, 3], 100]
    ];
    for (let i = 0; i < cases.length; i++) {
        let nums = cases[i][0];
        let target = cases[i][1];
        let pair = two_sum(nums, target);
        console.log(String(pair[0]) + " " + String(pair[1]));
    }
}

main();
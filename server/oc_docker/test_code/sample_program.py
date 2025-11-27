import time


def greet(name: str) -> str:
    msg = f"Hello, {name}"
    print(msg)
    return msg


def compute(n: int) -> int:
    total = 0
    for i in range(n):
        x = greet(f"user-{i}")
        total += i
        print("loop", i, x, total)
        time.sleep(0.2)
    return total


if __name__ == "__main__":
    result = compute(3)
    print("final result:", result)
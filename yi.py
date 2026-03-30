




fruits = ["apple", "banana", "orange", "grape", "watermelon"]

print("Quyidagilardan tanlang:")
for i, fruit in enumerate(fruits, 1):
    print(f"{i}. {fruit}")

choice = int(input("Raqam kiriting (1-5): "))

if 1 <= choice <= len(fruits):
    selected = fruits.pop(choice - 1)  # 1->0, 2->1 ...
    print("Tanlandi:", selected)
    print("Qolganlari:", ", ".join(fruits))
else:
    print("Xato tanlov!")



uy = ["apple", "banana", "orange", "grape", "watermelon"]
i = 4
print(uy[i])
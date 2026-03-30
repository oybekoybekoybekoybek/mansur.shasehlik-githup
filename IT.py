
# SET

# CRUD  =>   Create | Read | Update | Delete 
# ---------------------------------------------------------
# BASIC Methods
# x = s.pop()    # tasodifiy elementni uchiradi
# s.clear()      # set-ni ichidagi hamma narsani uchiradi
# a.copy()       # set-ni kopyasini boshqa ID bilan yasaydi
# s.add(...)     # set-ni ichiga element qushish
# s.remove(...)  # set-ni ichidan qiymatni topib uchirib beradi
# s.discard(...) # remove bilan birxil, faqat topolmasa xatolik BERMAYDI
# s.union({...}) # 2 ta setni birlashtirib boshqa set yaratadi
# ---------------------------------------------------------
# INTERMEDIATE and ADVANCED methods

# {...}.difference({...})  # 1-set 2-sidan qanday farq qiladi
# {...}.symmetric_difference({...})  # 1chi va 2chi setlarni umumiy farqi
# {...}.intersection({...})  # bir xil elementlarni chiqaradi
# a.isdisjoint(b)    =>  True if null-intersection else False
# ---------------------------------------------------
# UPDATE
# x.update({...})   =>  x ni originali uzgartiriladi
# x.intersection_update({...})  => birxil elementlarni originalni ichiga saqlaydi
# x.difference_update({...})  => har-xil elementlarni originalni ichiga saqlaydi
# x.symmetric_difference_update({...})  => har-xil elementlarni originalni ichiga saqlaydi








a = {1, 2, 3, 4, 5}
b = {          4, 5, 6, 7, 8}
a.update(b)
print(a)
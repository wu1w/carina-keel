import os
p = r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
print("blender_exists", os.path.isfile(p))
print("blender_path", p)
for d in [
    r"C:\Users\wuyw\AppData\Local\Fab",
    r"C:\Users\wuyw\Documents\Quixel",
    r"C:\Users\wuyw\Quixel",
    r"G:\Epic Games",
]:
    print(d, os.path.isdir(d))

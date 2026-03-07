import os

root_dir = r"c:\Cursor AI\docs\audits\reading-journey-vn-sim\2026-03-06\outlines"
matches = []

for subdir in os.listdir(root_dir):
    dir_path = os.path.join(root_dir, subdir)
    if not os.path.isdir(dir_path):
        continue
    
    found_chef = False
    found_challenge = False
    found_healthy = False
    
    # Check all files in this directory
    for filename in os.listdir(dir_path):
        file_path = os.path.join(dir_path, filename)
        if not os.path.isfile(file_path):
            continue
            
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read().lower()
                if 'chef' in content: found_chef = True
                if 'challenge' in content: found_challenge = True
                if 'healthy' in content: found_healthy = True
        except:
            pass
            
    if found_chef and found_challenge and found_healthy:
        matches.append(subdir)

if matches:
    print("Potential matches (folders containing 'chef', 'challenge', and 'healthy'):")
    for m in matches:
        print(m)
else:
    print("No folders found containing all three keywords.")

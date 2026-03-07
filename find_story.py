import os
import json

root_dir = r"c:\Cursor AI\docs\audits\reading-journey-vn-sim\2026-03-06\outlines"
matches = []

for subdir in os.listdir(root_dir):
    outline_path = os.path.join(root_dir, subdir, "outline.json")
    if os.path.exists(outline_path):
        try:
            with open(outline_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                title = data.get('title', '')
                if 'Healthy' in title and 'Chef' in title:
                    matches.append(f"{subdir}: {title}")
                elif 'Chef' in title and 'Challenge' in title:
                    matches.append(f"{subdir}: {title}")
                elif 'Healthy' in title and 'Challenge' in title:
                    # Already saw many of these, but let's list them just in case
                    if 'Chef' in title: # redundant but safe
                         matches.append(f"{subdir}: {title}")
        except Exception as e:
            pass

if matches:
    print("\n".join(matches))
else:
    print("No direct title matches found.")

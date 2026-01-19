
import os

file_path = "c:\\Cursor AI\\srs-review.js"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix template strings (remove backslashes)
content = content.replace("\\${", "${")

# Fix specific weird spacing issues seen in view_file
content = content.replace("< span", "<span")
content = content.replace("</span >", "</span>")
content = content.replace("< li >", "<li>")
content = content.replace("</li >", "</li>")
content = content.replace("${ s }", "${s}")
content = content.replace("${ p }", "${p}")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Fixed srs-review.js")

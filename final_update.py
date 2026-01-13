
import os

files = [
    r"c:\Cursor AI\backend\server.py",
    r"c:\Cursor AI\pronunciation-analyzer\stress-visualizer.js",
    r"c:\Cursor AI\pronunciation-analyzer\word-reference-service.js",
    r"c:\Cursor AI\pronunciation-analyzer\main.js",
    r"c:\Cursor AI\pronunciation-analyzer\praat-api.js"
]

output_file = r"c:\Cursor AI\pronunciation-analyzer-code.txt"

try:
    with open(output_file, 'w', encoding='utf-8') as outfile:
        for fpath in files:
            try:
                with open(fpath, 'r', encoding='utf-8') as infile:
                    content = infile.read()
                    outfile.write("=" * 50 + "\n")
                    outfile.write(f"FILE: {fpath}\n")
                    outfile.write("=" * 50 + "\n")
                    outfile.write(content)
                    outfile.write("\n\n")
            except Exception as e:
                outfile.write(f"Error reading {fpath}: {e}\n\n")
    print(f"Successfully updated {output_file}")
except Exception as e:
    print(f"Failed to write output file: {e}")

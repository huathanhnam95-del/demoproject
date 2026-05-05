import fitz
import sys

# Ensure stdout can handle utf-8 to avoid charmap errors
sys.stdout.reconfigure(encoding='utf-8')

doc = fitz.open(r'C:\Users\Admin\Downloads\Tam hon cao thuong (EdmondDeAmicis, HaMaiAnh dich)_original.pdf')
page = doc.load_page(4)
blocks = page.get_text('dict')['blocks']
text_blocks = [b for b in blocks if b['type'] == 0]
if text_blocks:
    for line in text_blocks[0]['lines']:
        for span in line['spans']:
            print(f"Text: '{span['text']}', Font: {span['font']}, Size: {span['size']}, Flags: {span['flags']}")

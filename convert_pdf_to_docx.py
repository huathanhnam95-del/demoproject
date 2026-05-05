import fitz
from docx import Document
import os

pdf_path = r'C:\Users\Admin\Downloads\Tam hon cao thuong (EdmondDeAmicis, HaMaiAnh dich)_original.pdf'
docx_path = r'C:\Users\Admin\Downloads\Tam_hon_cao_thuong_single_column.docx'

def convert_pdf_to_docx(pdf_path, docx_path):
    doc = fitz.open(pdf_path)
    docx = Document()
    
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        width = page.rect.width
        
        # Extract blocks: (x0, y0, x1, y1, text, block_no, block_type)
        blocks = page.get_text('blocks')
        
        # Filter out non-text blocks (block_type != 0)
        text_blocks = [b for b in blocks if b[6] == 0]
        
        # Separate into left and right columns
        left_blocks = []
        right_blocks = []
        
        for b in text_blocks:
            x0 = b[0]
            # Assume mid-point of the page is the column divider
            if x0 < width / 2:
                left_blocks.append(b)
            else:
                right_blocks.append(b)
                
        # Sort each column by y0 (top to bottom)
        left_blocks.sort(key=lambda b: b[1])
        right_blocks.sort(key=lambda b: b[1])
        
        # Combine columns: read left column entirely, then right column
        ordered_blocks = left_blocks + right_blocks
        
        for b in ordered_blocks:
            text = b[4]
            # Replace intra-block newlines with spaces to allow natural Word wrapping
            clean_text = text.replace('\n', ' ').strip()
            if clean_text:
                docx.add_paragraph(clean_text)
                
    docx.save(docx_path)
    print(f'Successfully created {docx_path}')

if __name__ == '__main__':
    convert_pdf_to_docx(pdf_path, docx_path)

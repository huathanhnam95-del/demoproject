import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import sys

def remove_text_and_add_new(image_path, output_path, new_text_lines):
    # Load image
    img = cv2.imread(image_path)
    if img is None:
        print(f"Could not load image at {image_path}")
        return

    # In the input image, the text is typically in the upper right.
    # The background is a solid or near-solid off-white color.
    # We will sample the background color from the top-right corner.
    bg_color = img[10, img.shape[1]-10].tolist()
    
    # Alternatively, let's just create a mask for dark pixels in the top-right area 
    # and fill them with the background color to erase "DƯỢNG ĐÂY"
    h, w, _ = img.shape
    
    # Estimate the region of the text (right side, upper half)
    # The pig is on the left, text on the right.
    # We will draw a filled rectangle over the text area. 
    # The text roughly spans from x: w*0.5 to w, and y: 0 to h*0.5
    # Let's be safe and use a color-based fill or just a rectangle.
    
    # We will find all non-background pixels in the text region and overpaint them.
    # A simpler approach: create a bounding box over the text and fill it with the bg color.
    # Let's guess the bounding box based on the image size.
    text_roi_x1 = int(w * 0.55)
    text_roi_y1 = int(h * 0.05)
    text_roi_x2 = int(w * 0.95)
    text_roi_y2 = int(h * 0.45)
    
    # Draw background color rectangle over old text
    cv2.rectangle(img, (text_roi_x1, text_roi_y1), (text_roi_x2, text_roi_y2), bg_color, -1)
    
    # Convert OpenCV image (BGR) to PIL image (RGB)
    img_pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(img_pil)
    
    # Load a font
    # We try to load a bold font. If not available, use default
    try:
        font = ImageFont.truetype("arialbd.ttf", int(h*0.1))
    except IOError:
        try:
            # For Windows
            font = ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", int(h*0.1))
        except IOError:
            font = ImageFont.load_default()
            
    # Text configuration
    text_color = (40, 50, 60) # Dark gray, similar to the original text
    
    # Draw new text lines
    y_text = text_roi_y1
    for line in new_text_lines:
        line_bbox = draw.textbbox((0, 0), line, font=font)
        line_w = line_bbox[2] - line_bbox[0]
        line_h = line_bbox[3] - line_bbox[1]
        
        # Center the text in the ROI
        x_text = text_roi_x1 + (text_roi_x2 - text_roi_x1 - line_w) // 2
        draw.text((x_text, y_text), line, font=font, fill=text_color)
        y_text += int(line_h * 1.2)
        
    # Convert back to OpenCV format if needed, but we can just save with PIL
    img_pil.save(output_path)
    print(f"Saved edited image to {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python edit_image.py <path_to_image>")
        sys.exit(1)
        
    input_image = sys.argv[1]
    output_image = input_image.replace(".png", "_edited.png").replace(".jpg", "_edited.jpg")
    
    new_text = ["ANH HEO", "ĐÂY"]
    remove_text_and_add_new(input_image, output_image, new_text)

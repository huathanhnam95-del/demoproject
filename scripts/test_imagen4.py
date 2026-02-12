import os
import requests
import base64
from io import BytesIO
from PIL import Image

API_KEY_VERTEX = "AQ.Ab8RN6LiBU7Uh09wMsJ0wdLshpXFSkf6tD8R9SLwDj1WsfroTg"
MODEL_ID_VERTEX = "imagen-4.0-generate-preview-06-06"

def test_imagen4():
    url = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{MODEL_ID_VERTEX}:predict?key={API_KEY_VERTEX}"
    
    # Simple prompt to test
    prompt = "Dragon Nest-style hand-painted HQ fantasy ability icon, 256x256. A forbidden grimoire releasing a bright blue-white beam."
    
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1}
    }
    
    print(f"Testing Imagen 4.0 with prompt: {prompt}")
    try:
        response = requests.post(url, json=payload, timeout=60)
        res_json = response.json()
        
        if "predictions" in res_json:
            img_b64 = res_json["predictions"][0]["bytesBase64Encoded"]
            image_data = base64.b64decode(img_b64)
            img = Image.open(BytesIO(image_data))
            img.save("public/assets/skill-icons/custom/test_imagen4.png")
            print("Successfully saved test_imagen4.png")
        else:
            print(f"Error: {res_json}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_imagen4()

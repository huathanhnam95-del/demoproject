import os

def diagnose():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    print(f"File location: {current_dir}")
    
    potential_root = current_dir
    found_root = False
    for i in range(4):
        p_json = os.path.join(potential_root, "package.json")
        l_pem = os.path.join(potential_root, "localhost.pem")
        print(f"Checking level {i}: {potential_root}")
        print(f"  Exists package.json: {os.path.exists(p_json)}")
        print(f"  Exists localhost.pem: {os.path.exists(l_pem)}")
        
        if os.path.exists(p_json) or os.path.exists(l_pem):
            found_root = True
            break
        potential_root = os.path.dirname(potential_root)
        
    if found_root:
        print(f"SUCCESS: Found root at {potential_root}")
    else:
        print("FAILED: Could not find root")

if __name__ == "__main__":
    diagnose()

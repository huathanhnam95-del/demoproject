import win32com.client
import sys
import os
import time

filepath = r"c:\Cursor AI\org_chart.vsdx"
csvpath = r"c:\Cursor AI\org_chart.csv"

if os.path.exists(filepath):
    try:
        os.remove(filepath)
    except:
        pass

try:
    print("Connecting to Visio...")
    visio = win32com.client.Dispatch("Visio.Application")
    # Make it visible just so the wizard doesn't hang in background if it expects UI
    visio.Visible = True 
    print("Visio opened.")
    
    addon = visio.Addons.ItemU("OrgCWiz")
    # Addon arguments. The arguments must be formatted exactly.
    args = f'/FILENAME="{csvpath}" /NAME-FIELD=Name /MANAGER-FIELD="Reports To" /DISPLAY-FIELDS=Name /PICTURE-DIRECTORY= /SYNC-WITH-DATA=0 /DISPLAY-PICTURES=0 /SHOW-DIVIDER-LINE=0 /CUSTOM-PROPERTY-FIELDS='
    print(f"Running org chart wizard with args: {args}")
    addon.Run(args)
    
    # Wait for completion - OrgCWiz is synchronous though and blocking, but just in case
    print("Wizard completed.")
    
    doc = visio.ActiveDocument
    if doc:
        print("Saving document...")
        doc.SaveAs(filepath)
        print("Save complete.")
    else:
        print("Error: No active document found after running the wizard.")
finally:
    try:
        visio.Quit()
        print("Visio closed.")
    except:
        pass

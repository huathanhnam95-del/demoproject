---
description: Automatically open the browser to labs.google/whisk to generate an image or video based on a prompt.
---
# Whisk Generation Workflow

This workflow uses the browser agent to automate the generation of media using Google Labs Whisk and consumes actual user AI credits.

1. Ensure you have the precise, detailed prompt ready, detailing the aesthetic, subject, and any animation sequence required.
2. Call the `browser_subagent` tool with the following Task instructions:
   - "Navigate to https://labs.google/whisk"
   - "Check if the user is already logged in based on the avatars/UI. If a login prompt appears or no account is active, stop and return a failure message indicating manual login is needed."
   - "Once on the main Whisk interface, locate the text input for the generation prompt."
   - "Paste the following prompt into the input field: [INSERT YOUR EXACT PROMPT HERE]"
   - "Click the generate button."
   - "Wait up to 60 seconds for the generation to complete, visually monitoring the screen for the loading state to finish."
   - "Once the image or video is fully generated, find the download button or right-click to save the generated file."
   - "Wait for the download to complete. Return a success message and note the assumed filename if possible."
3. Once the subagent finishes successfully, use terminal commands to locate the most recently downloaded file in the user's `C:\Users\Admin\Downloads` folder.
4. Move or copy that downloaded file into the application's local asset directory where these thumbnails belong.
5. Provide a summary to the user indicating the credits were used and the file has been saved.

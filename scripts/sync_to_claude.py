import os
import shutil
import glob
import re

def sync_all():
    user_home = os.path.expanduser("~")
    workspace = r"c:\Cursor AI"
    
    claude_home = os.path.join(user_home, ".claude")
    claude_skills = os.path.join(claude_home, "skills")
    claude_commands = os.path.join(claude_home, "commands")
    claude_rules_dir = os.path.join(claude_home, "rules")
    claude_master_file = os.path.join(claude_home, "CLAUDE.md")
    
    ws_claude = os.path.join(workspace, ".claude")
    ws_claude_skills = os.path.join(ws_claude, "skills")
    ws_claude_commands = os.path.join(ws_claude, "commands")
    ws_claude_master = os.path.join(workspace, "CLAUDE.md")

    for path in [claude_skills, claude_commands, claude_rules_dir, ws_claude_skills, ws_claude_commands]:
        os.makedirs(path, exist_ok=True)

    skill_sources = [
        os.path.join(workspace, ".agent", "skills"),
        os.path.join(user_home, ".gemini", "antigravity", "skills"),
        os.path.join(user_home, ".codex", "skills"),
    ]

    imported_skills = set()
    skipped_skills = 0

    print("=== 1. Importing & Merging Skills ===")
    for src in skill_sources:
        if not os.path.exists(src):
            print(f"Skipping non-existent source: {src}")
            continue
        print(f"Scanning skills in {src}...")
        for item in os.listdir(src):
            item_path = os.path.join(src, item)
            if item.startswith("."):
                continue
            if os.path.isdir(item_path):
                dest_global = os.path.join(claude_skills, item)
                dest_ws = os.path.join(ws_claude_skills, item)
                
                # Copy/Overwrite to global and workspace
                if os.path.exists(dest_global):
                    shutil.rmtree(dest_global)
                if os.path.exists(dest_ws):
                    shutil.rmtree(dest_ws)
                    
                shutil.copytree(item_path, dest_global)
                shutil.copytree(item_path, dest_ws)
                imported_skills.add(item)

    print(f"Total unique skills imported to Claude: {len(imported_skills)}")

    print("\n=== 2. Importing & Converting Workflows to Commands ===")
    workflow_sources = [
        os.path.join(workspace, ".agent", "workflows"),
        os.path.join(user_home, ".codex", "get-shit-done", "workflows")
    ]

    imported_commands = set()
    for src in workflow_sources:
        if not os.path.exists(src):
            continue
        print(f"Scanning workflows in {src}...")
        for wf_file in glob.glob(os.path.join(src, "*.md")):
            cmd_name = os.path.basename(wf_file)
            cmd_global = os.path.join(claude_commands, cmd_name)
            cmd_ws = os.path.join(ws_claude_commands, cmd_name)
            
            shutil.copy2(wf_file, cmd_global)
            shutil.copy2(wf_file, cmd_ws)
            imported_commands.add(cmd_name)

    print(f"Total commands imported to Claude: {len(imported_commands)}")

    print("\n=== 3. Importing & Synthesizing Rules ===")
    rules_content = []

    # Headings and System Rules
    master_header = """# Master Claude Rules & Context

> **Combined Source of Truth imported from Gemini / Antigravity and Codex**

## Response Timestamps
- In every final response to the user, include both `Start time` and `End time`.
- Use a human-readable Vietnam Time format (e.g., `Wednesday, May 20, 2026, 05:23:10 AM`) instead of ISO 8601 string representation.

## Browser Testing Credentials & Workflow
- For any browser testing plan or browser test execution that requires login, read `C:\\Cursor AI\\.local\\browser-test-credentials.md`.
- Playwright-based testing is the primary browser verification pass for Chrome.
- Chrome is the default and mandatory browser for all test plans.

## Task Tracking & Verification (MANDATORY)
- Continuous Tracking: Automatically check and update `TASK_TRACKER.csv` in the root workspace.
- Starting a task: Append `TaskNo,CreatedDate,Description,Status,DoneDate` with status 'In Progress'.
- Completing a task: Update status to 'Done' and set Done Date.
- Targeted line edits — never rewrite full CSV file.
- Empirical Verification required: Never mark Done without proof.

## GSD Auto-Integration Protocol
- **Quick Fix**: Execute -> Verify -> Done
- **Feature**: Plan -> Pause for Approval -> Execute -> Verify -> Done
- **Investigation**: Research -> Diagnose -> Fix -> Verify -> Done

## UI Design Rules
- **Avoid Nested Card Structures ("Boxes in Boxes")**: Avoid wrapping components in multiple layers of cards or nested container boxes. Layout elements should flow naturally on the parent `.container` background.

## Council Workflow
- When user includes `#council`, execute `node scripts/summon_council.js "<request>"`.

## Deployment Rules
- **Remote Git Synchronization on Production Deployment**: Whenever deploying to production (or executing an approved production release / PAR), ALWAYS push the committed changes to the remote Git repository (`git push origin <branch>`) in addition to deploying the hosting assets. Never leave production releases unpushed to Git. Outside of an explicit deployment/release instruction, do not perform unprompted pushes to production branches.
"""

    rules_content.append(master_header)

    # Read additional rules from .agent/rules
    agent_rules_dir = os.path.join(workspace, ".agent", "rules")
    if os.path.exists(agent_rules_dir):
        for rf in glob.glob(os.path.join(agent_rules_dir, "*.md")):
            with open(rf, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                rule_name = os.path.basename(rf)
                # Copy to claude rules dir
                shutil.copy2(rf, os.path.join(claude_rules_dir, rule_name))
                rules_content.append(f"\n--- \n### Modular Rule: {rule_name}\n" + content)

    # Read codex default rules
    codex_rules_file = os.path.join(user_home, ".codex", "rules", "default.rules")
    if os.path.exists(codex_rules_file):
        with open(codex_rules_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            shutil.copy2(codex_rules_file, os.path.join(claude_rules_dir, "codex_default.rules"))
            rules_content.append("\n---\n### Codex Base Rules\n" + content[:3000] + "\n... (truncated for brevity)")

    full_claude_md = "\n".join(rules_content)

    with open(claude_master_file, "w", encoding="utf-8") as f:
        f.write(full_claude_md)

    with open(ws_claude_master, "w", encoding="utf-8") as f:
        f.write(full_claude_md)

    print(f"Master CLAUDE.md created at:\n  - {claude_master_file}\n  - {ws_claude_master}")
    print("\nSUCCESS: All skills, rules, and workflows imported successfully to Claude!")

if __name__ == "__main__":
    sync_all()

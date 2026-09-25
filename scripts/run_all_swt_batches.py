#!/usr/bin/env python3
"""
run_all_swt_batches.py — Batch Orchestration & Verification Runner for SWT 3-Model Pipeline

Iterates through sequential chunks of questions (51–100, 101–150, ..., 351–482)
ensuring single-model Ollama execution, incremental persistence, and verification gates.
"""

import os
import sys
import time
import subprocess
import argparse

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

BATCHES = [
    (1, 51, 100),
    (2, 101, 150),
    (3, 151, 200),
    (4, 201, 250),
    (5, 251, 300),
    (6, 301, 350),
    (7, 351, 482),
]

def run_command(cmd, cwd=WORKSPACE_DIR):
    print(f"\n[RUN] {' '.join(cmd)}", flush=True)
    t0 = time.time()
    res = subprocess.run(cmd, cwd=cwd)
    elapsed = time.time() - t0
    print(f"[EXIT] Code: {res.returncode} (took {elapsed:.1f}s)", flush=True)
    return res.returncode

def main():
    parser = argparse.ArgumentParser(description="Run SWT 3-Model Batches Sequentially")
    parser.add_argument("--batch", type=int, choices=range(1, 8), help="Run a specific batch (1-7)")
    parser.add_argument("--start-batch", type=int, default=1, choices=range(1, 8), help="Start from batch (1-7)")
    parser.add_argument("--max-batches", type=int, default=7, help="Maximum number of batches to run")
    args = parser.parse_args()

    selected_batches = []
    if args.batch:
        selected_batches = [b for b in BATCHES if b[0] == args.batch]
    else:
        selected_batches = [b for b in BATCHES if b[0] >= args.start_batch][:args.max_batches]

    print("=================================================================", flush=True)
    print("  SWT 3-Model Local LLM Master Batch Orchestrator", flush=True)
    print("=================================================================", flush=True)
    print(f"Scheduled Batches: {[f'Batch {b[0]} (Q#{b[1]}–Q#{b[2]})' for b in selected_batches]}", flush=True)
    total_start = time.time()

    for b_num, start_id, end_id in selected_batches:
        print(f"\n=======================================================", flush=True)
        print(f"  STARTING BATCH {b_num}: Questions #{start_id} to #{end_id}", flush=True)
        print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S ICT', time.localtime())}", flush=True)
        print(f"=======================================================", flush=True)

        # Step 1: Run batch generation & 3-model audit
        gen_cmd = [
            sys.executable, "-u",
            os.path.join(WORKSPACE_DIR, "scripts", "batch_generate_and_audit_swt.py"),
            "--start", str(start_id),
            "--end", str(end_id)
        ]
        rc = run_command(gen_cmd)
        if rc != 0:
            print(f"\n[ERROR] Batch {b_num} generation exited with code {rc}. Halting.", flush=True)
            sys.exit(rc)

        # Step 2: Run verification audit
        audit_cmd = [
            sys.executable, "-u",
            os.path.join(WORKSPACE_DIR, "scripts", "audit_swt_questions.py"),
            "--start", str(start_id),
            "--end", str(end_id)
        ]
        audit_rc = run_command(audit_cmd)
        if audit_rc != 0:
            print(f"\n[WARN] Batch {b_num} audit flagged issues. Attempting self-healing remediation...", flush=True)
            heal_cmd = [
                sys.executable, "-u",
                os.path.join(WORKSPACE_DIR, "scripts", "batch_generate_and_audit_swt.py"),
                "--start", str(start_id),
                "--end", str(end_id),
                "--only-failing",
                "--force"
            ]
            run_command(heal_cmd)
            # Re-check audit
            if run_command(audit_cmd) != 0:
                print(f"\n[ERROR] Batch {b_num} still failed audit after self-healing. Halting.", flush=True)
                sys.exit(1)

        # Step 3: Run overall integrity check
        integ_cmd = ["node", os.path.join(WORKSPACE_DIR, "tests", "swt-pilot-integrity.test.js")]
        integ_rc = run_command(integ_cmd)
        if integ_rc != 0:
            print(f"\n[ERROR] Integrity test failed after Batch {b_num}. Halting.", flush=True)
            sys.exit(integ_rc)

        print(f"\n[SUCCESS] Batch {b_num} (Questions #{start_id}–#{end_id}) completed & verified successfully!", flush=True)

    total_time = time.time() - total_start
    print(f"\n=================================================================", flush=True)
    print(f"  All Selected Batches Completed Successfully in {total_time/60:.1f} minutes", flush=True)
    print(f"=================================================================", flush=True)

if __name__ == "__main__":
    main()

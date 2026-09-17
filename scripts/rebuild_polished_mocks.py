"""
scripts/rebuild_polished_mocks.py
Sequentially re-renders Option A, Option B, Option C, then verifies all 4 options.
"""

import os
import sys
import subprocess
import time

def run_script(script_name):
    print(f"\n==========================================")
    print(f"RUNNING: {script_name}")
    print(f"==========================================")
    t0 = time.time()
    res = subprocess.run([sys.executable, script_name], check=True)
    dt = time.time() - t0
    print(f"FINISHED: {script_name} in {dt:.2f}s")

if __name__ == "__main__":
    run_script("scripts/render_option_a_whiteboard.py")
    run_script("scripts/render_option_b_cartoon_avatar.py")
    run_script("scripts/render_option_c_rotoscope_vignette.py")
    run_script("scripts/render_option_d_technical_blueprint.py")
    run_script("scripts/verify_all_mock_options.py")
    print("\nALL POLISHED RENDERS COMPLETED SUCCESSFULLY!")

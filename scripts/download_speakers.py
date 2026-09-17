
import os, subprocess, shutil

TEMP_DIR = r'c:\Cursor AI\assets\temp_clips'
PORTRAITS_DIR = r'c:\Cursor AI\assets\speaker_portraits'
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(PORTRAITS_DIR, exist_ok=True)

# Let's download a 15-second clip for Josh Weier, Mike Morasky, and Erik Wolpaw from Ye2sNYXDUtw
targets = [
    ('josh_weier', 'Ye2sNYXDUtw', '04:18', '04:30', 5),
    ('mike_morasky', 'Ye2sNYXDUtw', '05:05', '05:18', 6),
    ('erik_wolpaw', 'Ye2sNYXDUtw', '08:20', '08:35', 7),
]

for name, vid, start, end, frame_sec in targets:
    out_clip = os.path.join(TEMP_DIR, f'{name}.mp4')
    if not os.path.exists(out_clip):
        print(f'Downloading clip for {name} ({start}-{end})...')
        cmd = [
            'yt-dlp',
            '--download-sections', f'*{start}-{end}',
            '-f', 'bestvideo[height<=1080]',
            '--force-keyframes-at-cuts',
            '-o', out_clip,
            f'https://www.youtube.com/watch?v={vid}'
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        if res.returncode != 0:
            print(f'Error downloading {name}:', res.stderr)
        else:
            print(f'Downloaded {name} clip successfully.')

    # Extract frame
    out_frame = os.path.join(PORTRAITS_DIR, f'{name}_raw.png')
    print(f'Extracting frame for {name} at {frame_sec}s...')
    ff_cmd = [
        'ffmpeg', '-y',
        '-ss', f'00:00:{frame_sec:02d}',
        '-i', out_clip,
        '-vframes', '1',
        '-q:v', '1',
        out_frame
    ]
    subprocess.run(ff_cmd, capture_output=True)
    print(f'Done extracting {name} -> {out_frame}')

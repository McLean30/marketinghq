"""Split the approved three-panel artwork (design/source-art/team-three-panel.webp) into the three HQ portraits:
Calibre (left), Vantage (centre) and Cue (right), cropped to the 446 x 695 frame Quill and Prism use.
Usage: python3 tools/split-team-art.py   (needs Pillow)"""
from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, 'design', 'source-art', 'team-three-panel.webp')).convert('RGB')
W, H = 446, 695
# Panel dividers measured at x = 510-513 and 1022-1025 (thin light lines); crop clear of them, from the top.
for name, (x0, x1) in {'calibre': (0, 510), 'vantage': (514, 1022), 'cue': (1026, 1536)}.items():
    h = round((x1 - x0) * H / W)
    out = src.crop((x0, 0, x1, h)).resize((W, H), Image.LANCZOS)
    out.save(os.path.join(ROOT, 'public', 'assets', 'agents', f'{name}.webp'), 'WEBP', quality=84, method=6)
    print(name, os.path.getsize(os.path.join(ROOT, 'public', 'assets', 'agents', f'{name}.webp')) // 1024, 'KB')

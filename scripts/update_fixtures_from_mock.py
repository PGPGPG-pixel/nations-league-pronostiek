#!/usr/bin/env python3
import re, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
app_js = ROOT / 'app.js'
fx = ROOT / 'fixtures.json'
text = app_js.read_text(encoding='utf-8')
# find mockMatches array content
m = re.search(r'mockMatches\s*=\s*\[([\s\S]*?)\];', text)
map_dates = {}
if m:
    arr = m.group(1)
    # find objects with id and date
    for obj in re.finditer(r"\{\s*id:\s*'(?P<id>\d+)'[\s\S]*?date:\s*'(?P<date>[^']*)'", arr):
        map_dates[obj.group('id')] = obj.group('date')
# load fixtures
fixtures = json.loads(fx.read_text(encoding='utf-8'))
updated = False
for f in fixtures:
    if (not f.get('date')) and f.get('id') in map_dates and map_dates[f.get('id')]:
        f['date'] = map_dates[f['id']]
        updated = True
if updated:
    fx.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Updated fixtures.json with dates from app.js')
else:
    print('No updates made')

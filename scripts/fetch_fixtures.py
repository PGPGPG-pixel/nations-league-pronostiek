#!/usr/bin/env python3
"""
Simple scraper to fetch UEFA Nations League fixtures from the provided page
and write a fixtures.json file into the project root.

Usage:
  python scripts/fetch_fixtures.py "https://www.uefa.com/uefanationsleague/fixtures-results/#/d/2026-09-24"

This is a best-effort scraper that looks for links containing "/api/v1/linkrules/match/"
and extracts match id, teams and time. Results are written to ../fixtures.json
"""
import sys
import re
import json
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup


def fetch(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    return r.text


def parse(html, default_date=None):
    soup = BeautifulSoup(html, 'html.parser')
    matches = []
    anchors = soup.find_all('a', href=re.compile(r'/api/v1/linkrules/match/'))
    seen = set()
    for a in anchors:
        href = a.get('href')
        m = re.search(r'/match/(\d+)', href)
        if not m:
            continue
        match_id = m.group(1)
        if match_id in seen:
            continue
        seen.add(match_id)
        text = (a.get_text(separator=' ', strip=True) or '')
        # try to extract teams from surrounding text
        parent_text = a.parent.get_text(separator=' ', strip=True) if a.parent else text
        combined = text + ' ' + parent_text
        # look for 'Upcoming match - Team - Team' pattern
        tm = re.search(r'Upcoming match\s*-\s*(.*?)\s*-\s*(.*?)($|\s)', combined)
        if tm:
            home = tm.group(1).strip()
            away = tm.group(2).strip()
        else:
            # fallback: split by hyphen in the anchor text
            parts = text.split('-')
            if len(parts) >= 2:
                home = parts[-2].strip()
                away = parts[-1].strip()
            else:
                # last fallback: try to split words (not ideal)
                parts = combined.split()
                home = parts[0] if parts else 'Team A'
                away = parts[1] if len(parts) > 1 else 'Team B'
        # try to get time (HH:MM)
        tmatch = re.search(r'(\d{2}:\d{2})', combined)
        time = tmatch.group(1) if tmatch else ''
        date = default_date or ''
        if default_date and time:
            date = f"{default_date} {time}"
        matches.append({
            'id': match_id,
            'league': '',
            'date': date,
            'home': home,
            'away': away
        })
    return matches


def write_fixtures(fixtures, path='../fixtures.json'):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(fixtures, f, ensure_ascii=False, indent=2)
    print(f'Wrote {len(fixtures)} fixtures to {path}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: fetch_fixtures.py <uefa-fixtures-url>')
        sys.exit(1)
    url = sys.argv[1]
    # attempt to parse date from fragment /d/YYYY-MM-DD
    parsed = urlparse(url)
    frag = parsed.fragment or ''
    default_date = None
    m = re.search(r'/d/(\d{4}-\d{2}-\d{2})', frag)
    if m:
        default_date = m.group(1)
    print('Fetching', url)
    html = fetch(url)
    fixtures = parse(html, default_date)
    if not fixtures:
        print('No fixtures found. The page may be heavily JS-rendered. Try opening the page in a browser and provide a direct JSON source or use the UEFA API endpoints.')
    write_fixtures(fixtures)

#!/usr/bin/env python3
"""Fetch match pages and extract date/time from HTML (time tags, JSON-LD)
Usage: python scripts/fetch_dates_from_match_pages.py
"""
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

DATE_PATTERNS = [
    r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:?\d{0,2})',
    r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2})',
]


def extract_from_html(html):
    # look for JSON-LD script with startDate
    m = re.search(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S|re.I)
    if m:
        try:
            j = json.loads(m.group(1))
            if isinstance(j, dict):
                if 'startDate' in j:
                    return j['startDate']
                # sometimes nested
                for k in ['start_date', 'startDate', 'datePublished', 'date']:
                    if k in j and isinstance(j[k], str):
                        return j[k]
        except Exception:
            pass
    # look for <time datetime="...">
    m2 = re.search(r'<time[^>]+datetime=["\']([^"\']+)["\']', html, re.I)
    if m2:
        return m2.group(1)
    # fallback: generic ISO datetime in page
    for pat in DATE_PATTERNS:
        m3 = re.search(pat, html)
        if m3:
            return m3.group(1)
    return None


def main():
    root = Path(__file__).resolve().parents[1]
    fixtures_path = root / 'fixtures.json'
    public_path = root / 'public' / 'fixtures.json'

    with open(fixtures_path, 'r', encoding='utf-8') as f:
        fixtures = json.load(f)

    ids_to_check = [m['id'] for m in fixtures if not m.get('date')]
    if not ids_to_check:
        print('No missing dates found.')
        return

    updated = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        for mid in ids_to_check:
            url = f'https://www.uefa.com/match/{mid}/'
            try:
                resp = page.request.get(url)
                if not resp.ok:
                    print('Failed', mid, resp.status)
                    continue
                raw = resp.text()
                val = extract_from_html(raw)
                if val:
                    # normalize possible ISO to 'YYYY-MM-DD HH:MM'
                    iso = None
                    m_iso = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})', val)
                    if m_iso:
                        iso = m_iso.group(1).replace('T',' ')
                    else:
                        m_iso2 = re.search(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2})', val)
                        if m_iso2:
                            iso = m_iso2.group(1)
                    if iso:
                        for m in fixtures:
                            if m.get('id') == mid:
                                m['date'] = iso
                                updated += 1
                                print('Found', mid, iso)
                                break
            except Exception as e:
                print('Error', mid, e)
        browser.close()

    if updated:
        with open(fixtures_path, 'w', encoding='utf-8') as f:
            json.dump(fixtures, f, ensure_ascii=False, indent=2)
        try:
            with open(public_path, 'w', encoding='utf-8') as f:
                json.dump(fixtures, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    print(f'Done. Updated {updated} fixtures.')


if __name__ == '__main__':
    main()

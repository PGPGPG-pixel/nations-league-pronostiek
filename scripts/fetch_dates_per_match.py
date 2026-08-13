#!/usr/bin/env python3
"""Fetch per-match JSON from UEFA and fill missing dates in fixtures.json
Usage: python scripts/fetch_dates_per_match.py
"""
import json
import re
from pathlib import Path
from datetime import datetime as _dt
from playwright.sync_api import sync_playwright


def extract_date_from_json(j, default_date=None):
    candidates = ['kickoff','kickoffTime','start_time','startDate','startDateTime','date','utcDate','utcDateTime','kickoffUtc','matchDate','matchStart']
    for k in candidates:
        v = j.get(k) if isinstance(j, dict) else None
        if isinstance(v, str) and v:
            m_iso = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)', v)
            if m_iso:
                s = m_iso.group(1)
                try:
                    dt = _dt.fromisoformat(s)
                    return dt.strftime('%Y-%m-%d %H:%M')
                except Exception:
                    pass
            m_date = re.search(r'(\d{4}-\d{2}-\d{2})', v)
            if m_date and default_date is None:
                return m_date.group(1)
            m_time = re.search(r'(\d{2}:\d{2})', v)
            if m_time and default_date:
                return f"{default_date} {m_time.group(1)}"
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

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        updated = 0
        for mid in ids_to_check:
            url = f'https://www.uefa.com/api/v1/linkrules/match/{mid}/'
            try:
                resp = page.request.get(url)
                if not resp.ok:
                    print('Failed', mid, resp.status)
                    continue
                try:
                    j = resp.json()
                except Exception:
                    j = None
                date_val = None
                if isinstance(j, dict):
                    date_val = extract_date_from_json(j)
                if date_val:
                    # update fixtures
                    for m in fixtures:
                        if m.get('id') == mid:
                            m['date'] = date_val
                            updated += 1
                            print('Updated', mid, date_val)
                            break
            except Exception as e:
                print('Error fetching', mid, e)
        browser.close()

    if updated:
        with open(fixtures_path, 'w', encoding='utf-8') as f:
            json.dump(fixtures, f, ensure_ascii=False, indent=2)
        # also write to public
        try:
            with open(public_path, 'w', encoding='utf-8') as f:
                json.dump(fixtures, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    print(f'Done. Updated {updated} fixtures.')


if __name__ == '__main__':
    main()

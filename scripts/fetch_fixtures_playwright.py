#!/usr/bin/env python3
"""
Headless Playwright scraper for UEFA Nations League fixtures.
Usage:
  python scripts/fetch_fixtures_playwright.py "https://www.uefa.com/uefanationsleague/fixtures-results/#/d/2026-09-24"
Outputs: ../fixtures.json
"""
import sys, re, json
from datetime import datetime, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright
from datetime import datetime as _dt


def extract_from_items(items, default_date=None):
    results = []
    seen = set()
    # common country list to help matching
    countries = [
        'Portugal','Wales','Netherlands','Germany','Serbia','Greece','Norway','Denmark','Austria','Israel','Kosovo','Republic of Ireland','Liechtenstein','Lithuania','Andorra','Malta','Italy','Belgium','Türkiye','France','Georgia','Northern Ireland','England','Spain','North Macedonia','Switzerland','Czechia','Croatia','Poland','Sweden','Romania','Hungary','Ukraine','Scotland','Slovenia','Iceland','Estonia','Finland','San Marino','Albania','Belarus','Slovakia','Moldova','Bulgaria','Luxembourg','Faroe Islands','Kazakhstan','Armenia','Latvia','Montenegro','Cyprus','Gibraltar','Azerbaijan','Turkey'
    ]

    for it in items:
        href = it.get('href') or ''
        match = re.search(r'/match/(\d+)', href)
        match_id = match.group(1) if match else None
        if not match_id or match_id in seen:
            continue
        seen.add(match_id)
        combined = (it.get('text','') + '\n' + it.get('combined','') if it.get('combined') else it.get('text','') ).strip()

        # try explicit pattern first
        m = re.search(r'Upcoming match\s*-\s*(.*?)\s*-\s*(.*?)($|\n)', combined)
        if m:
            home = m.group(1).strip()
            away = m.group(2).strip()
        else:
            # try to find known country names inside the combined text
            low = combined.lower()
            found = []
            for c in countries:
                if c.lower() in low:
                    found.append(c)
            if len(found) >= 2:
                home, away = found[0], found[1]
            else:
                # try 'Home - Away' in anchor text
                parts = re.split(r'\s-\s|–|—', it.get('text',''))
                if len(parts) >= 2:
                    home = parts[-2].strip()
                    away = parts[-1].strip()
                else:
                    toks = re.findall(r'[A-Za-zÀ-ÖØ-öø-ÿ ]+', combined)
                    seg = ' '.join(toks).strip()
                    seg = seg.replace('\n',' ').strip()
                    words = seg.split()
                    home = words[0] if words else 'Team A'
                    away = words[1] if len(words) > 1 else 'Team B'

        # time (best-effort from combined text)
        t = re.search(r'(\d{2}:\d{2})', combined)
        time = t.group(1) if t else ''
        date = default_date or ''
        if default_date and time:
            date = f"{default_date} {time}"

        results.append({
            'id': match_id,
            'league': '',
            'date': date,
            'home': home,
            'away': away
        })
    return results


def extract_date_from_json(j, default_date=None):
    # Try common date/time keys in the API JSON
    candidates = ['kickoff','kickoffTime','start_time','startDate','startDateTime','date','utcDate','utcDateTime','kickoffUtc','matchDate','matchStart']
    for k in candidates:
        v = j.get(k) if isinstance(j, dict) else None
        if isinstance(v, str) and v:
            # ISO datetime
            m_iso = re.search(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)', v)
            if m_iso:
                s = m_iso.group(1)
                try:
                    dt = _dt.fromisoformat(s)
                    return dt.strftime('%Y-%m-%d %H:%M')
                except Exception:
                    pass
            # date only
            m_date = re.search(r'(\d{4}-\d{2}-\d{2})', v)
            if m_date and default_date is None:
                return m_date.group(1)
            # time only
            m_time = re.search(r'(\d{2}:\d{2})', v)
            if m_time and default_date:
                return f"{default_date} {m_time.group(1)}"
    return None

if __name__ == '__main__':
    # Usage: python scripts/fetch_fixtures_playwright.py <base_url> [start_date] [end_date]
    url = sys.argv[1] if len(sys.argv) > 1 else 'https://www.uefa.com/uefanationsleague/fixtures-results/'
    start_date = None
    end_date = None
    default_date = None
    # if url contains a single date fragment, use that as default
    m = re.search(r'/d/(\d{4}-\d{2}-\d{2})', url)
    if m:
        default_date = m.group(1)
    # optional start/end args
    if len(sys.argv) >= 3:
        start_date = sys.argv[2]
    if len(sys.argv) >= 4:
        end_date = sys.argv[3]

    out_path = Path(__file__).resolve().parents[1] / 'fixtures.json'

    all_items = []
    seen_hrefs = set()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        def fetch_for_date(target_url, target_date=None):
            print('Opening', target_url)
            try:
                page.goto(target_url, wait_until='networkidle', timeout=30000)
            except Exception as e:
                print('Failed to open', target_url, 'error:', e)
                return
            # try to accept cookie/consent dialogs that block content
            try:
                for label in ["I Accept", "I accept", "Accept all", "Accept", "Agree", "Alles accepteren"]:
                    try:
                        btn = page.locator(f"text=\"{label}\"")
                        if btn.count() > 0:
                            btn.first.click()
                            print('Clicked consent button:', label)
                            break
                    except Exception:
                        pass
            except Exception:
                pass
            # try click date label if present
            try:
                if target_date:
                    year, month, day = target_date.split('-')
                    for label in [f"{int(day)} Sep", f"{int(day)} {int(month)}", f"{int(day)}"]:
                        try:
                            el = page.locator(f"text=\"{label}\"")
                            if el.count() > 0:
                                el.first.click()
                                print('Clicked date label:', label)
                                break
                        except Exception:
                            pass
            except Exception:
                pass
            try:
                page.wait_for_selector('a[href*="/api/v1/linkrules/match/"]', timeout=15000)
            except Exception as e:
                print('Timed out waiting for match links:', e)
            anchors = page.query_selector_all('a[href*="/api/v1/linkrules/match/"]')
            for a in anchors:
                try:
                    href = a.get_attribute('href')
                    if href and href not in seen_hrefs:
                        seen_hrefs.add(href)
                        # fetch api page
                        full = href if href.startswith('http') else ('https://www.uefa.com' + href)
                        resp = page.request.get(full)
                        text = ''
                        combined = ''
                        try:
                            j = resp.json()
                        except Exception:
                            j = None
                        if isinstance(j, dict):
                            if 'homeTeam' in j and isinstance(j['homeTeam'], dict):
                                text = text or j['homeTeam'].get('name') or j['homeTeam'].get('nameEn') or ''
                            if 'awayTeam' in j and isinstance(j['awayTeam'], dict):
                                text = (text + ' ' + (j['awayTeam'].get('name') or j['awayTeam'].get('nameEn') or '')).strip()
                            combined = json.dumps(j)
                            # try extract date/time from the returned JSON
                            try:
                                date_val = extract_date_from_json(j, target_date)
                            except Exception:
                                date_val = target_date
                        else:
                            try:
                                raw = resp.text()
                            except Exception:
                                raw = ''
                            # extract from title/meta
                            name_found = False
                            try:
                                m = re.search(r'<title>([^<]+)</title>', raw, re.I)
                                if m:
                                    title = m.group(1).strip()
                                    first = title.split('|')[0].strip()
                                    for sep in [' - ', '-', '–', '—', ' vs ', ' v ', '–']:
                                        if sep in first:
                                            parts = [p.strip() for p in first.split(sep)]
                                            if len(parts) >= 2:
                                                home = parts[0]
                                                away = parts[1]
                                                text = (home + ' ' + away).strip()
                                                combined = raw
                                                name_found = True
                                                break
                            except Exception:
                                pass
                            if not name_found:
                                try:
                                    m = re.search(r'<meta name="description" content="([^"]+)"', raw, re.I)
                                    if m:
                                        desc = m.group(1)
                                        for sep in [' vs ', ' v ', ' - ', '-']:
                                            if sep in desc:
                                                parts = [p.strip() for p in desc.split(sep)]
                                                if len(parts) >= 2:
                                                    home = parts[0]
                                                    away = parts[1].split(':')[0].strip()
                                                    text = (home + ' ' + away).strip()
                                                    combined = raw
                                                    name_found = True
                                                    break
                                except Exception:
                                    pass
                        # ensure date_val is set (fallback to target_date)
                        try:
                            dv = date_val
                        except NameError:
                            dv = target_date
                        all_items.append({'href': href, 'text': text, 'combined': combined, 'date': dv})
                except Exception:
                    pass

        # iterate dates if start/end provided
        if start_date and end_date:
            s = datetime.fromisoformat(start_date)
            e = datetime.fromisoformat(end_date)
            d = s
            while d <= e:
                frag = d.strftime('%Y-%m-%d')
                target = re.sub(r'/#/d/\d{4}-\d{2}-\d{2}', '', url)
                if not target.endswith('/'):
                    target += '/'
                target = target + f"#/d/{frag}"
                fetch_for_date(target, frag)
                d = d + timedelta(days=1)
        else:
            fetch_for_date(url, default_date)
        # try to accept cookie/consent dialogs that block content
        try:
            for label in ["I Accept", "I accept", "Accept all", "Accept", "Agree", "Alles accepteren"]:
                try:
                    btn = page.locator(f"text=\"{label}\"")
                    if btn.count() > 0:
                        btn.first.click()
                        print('Clicked consent button:', label)
                        break
                except Exception:
                    pass
        except Exception:
            pass
        # if URL contains a date fragment, try clicking that date in the page calendar
        try:
            if default_date:
                # try several short formats
                year, month, day = default_date.split('-')
                txt1 = f"{int(day)} Sep" if month == '09' else f"{int(day)} {int(month)}"
                # try generic '24 Sep' text
                for label in [f"{int(day)} Sep", f"{int(day)} {int(month)}", f"{int(day)}"]:
                    try:
                        el = page.locator(f"text=\"{label}\"")
                        if el.count() > 0:
                            el.first.click()
                            print('Clicked date label:', label)
                            break
                    except Exception:
                        pass
        except Exception:
            pass
        # wait for match links to appear
        try:
            page.wait_for_selector('a[href*="/api/v1/linkrules/match/"]', timeout=30000)
        except Exception as e:
            print('Timed out waiting for match links:', e)
        # gather anchors and richer nearby text (ancestors, siblings, aria/title)
        # First, collect API hrefs from the page
        anchors = page.query_selector_all('a[href*="/api/v1/linkrules/match/"]')
        items = []
        for a in anchors:
            try:
                href = a.get_attribute('href')
                if not href:
                    continue
                full = href if href.startswith('http') else ('https://www.uefa.com' + href)
                resp = page.request.get(full)
                if not resp.ok:
                    continue
                try:
                    j = resp.json()
                except Exception:
                    j = None
                text = ''
                combined = ''
                if isinstance(j, dict):
                    if 'homeTeam' in j and isinstance(j['homeTeam'], dict):
                        text = text or j['homeTeam'].get('name') or j['homeTeam'].get('nameEn') or ''
                    if 'awayTeam' in j and isinstance(j['awayTeam'], dict):
                        text = (text + ' ' + (j['awayTeam'].get('name') or j['awayTeam'].get('nameEn') or '')).strip()
                    combined = json.dumps(j)
                else:
                    # HTML page returned — try to extract team names from <title> or meta description
                    try:
                        raw = resp.text()
                    except Exception:
                        raw = ''
                    name_found = False
                    try:
                        m = re.search(r'<title>([^<]+)</title>', raw, re.I)
                        if m:
                            title = m.group(1).strip()
                            first = title.split('|')[0].strip()
                            for sep in [' - ', '-', '–', '—', ' vs ', ' v ', '–']:
                                if sep in first:
                                    parts = [p.strip() for p in first.split(sep)]
                                    if len(parts) >= 2:
                                        home = parts[0]
                                        away = parts[1]
                                        text = (home + ' ' + away).strip()
                                        combined = raw
                                        name_found = True
                                        break
                    except Exception:
                        pass
                    if not name_found:
                        try:
                            m = re.search(r'<meta name="description" content="([^"]+)"', raw, re.I)
                            if m:
                                desc = m.group(1)
                                for sep in [' vs ', ' v ', ' - ', '-']:
                                    if sep in desc:
                                        parts = [p.strip() for p in desc.split(sep)]
                                        if len(parts) >= 2:
                                            home = parts[0]
                                            away = parts[1].split(':')[0].strip()
                                            text = (home + ' ' + away).strip()
                                            combined = raw
                                            name_found = True
                                            break
                        except Exception:
                            pass
                items.append({'href': href, 'text': text, 'combined': combined})
            except Exception:
                pass
        print(f'Found {len(items)} anchor(s) matching match links')
        for i, it in enumerate(items[:8]):
            print('SAMPLE', i, it.get('href'), repr(it.get('text')[:120]), '\n---combined---\n', repr(it.get('combined')[:300]))
        # dedupe items by href and pass to extractor
        scraped = extract_from_items(all_items, None)
        if not scraped:
            print('No fixtures extracted by Playwright. Trying to find match blocks...')
            # try alternative: look for elements with data-match-id attribute
            alt = page.query_selector_all('[data-match-id]')
            items2 = []
            for el in alt:
                try:
                    hid = el.get_attribute('data-match-id')
                    txt = el.inner_text() or ''
                    items2.append({'href': f'/match/{hid}', 'text': txt, 'parent': txt})
                except:
                    pass
            scraped = extract_from_items(items2, default_date)

        # write
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(scraped, f, ensure_ascii=False, indent=2)
        print(f'Wrote {len(scraped)} fixtures to {out_path}')
        browser.close()

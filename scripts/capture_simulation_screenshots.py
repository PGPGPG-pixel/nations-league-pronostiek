from playwright.sync_api import sync_playwright
import os
from pathlib import Path

repo_root = Path(__file__).resolve().parents[1]
public = repo_root / 'public'
screens_dir = public / 'screenshots'
screens_dir.mkdir(parents=True, exist_ok=True)

index_file = public / 'index.html'
url = index_file.as_uri()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1200, 'height':900})
    page.goto(url)
    page.wait_for_timeout(500)
    try:
        page.evaluate("if (typeof navigateTo==='function') navigateTo('groups')")
    except Exception:
        pass
    page.wait_for_timeout(600)
    # try click the 'Bekijk klassement' button inside a group card
    try:
        page.click("text=Bekijk klassement", timeout=2000)
    except Exception:
        pass
    page.wait_for_timeout(500)
    page.screenshot(path=str(screens_dir / 'group-leaderboard.png'))

    try:
        page.evaluate("if (typeof navigateTo==='function') navigateTo('leaderboard')")
    except Exception:
        pass
    page.wait_for_timeout(400)
    page.screenshot(path=str(screens_dir / 'leaderboard.png'))

    try:
        page.evaluate("if (typeof navigateTo==='function') navigateTo('matches')")
    except Exception:
        pass
    page.wait_for_timeout(400)
    page.screenshot(path=str(screens_dir / 'matches.png'))

    browser.close()

print('screenshots written to', str(screens_dir))
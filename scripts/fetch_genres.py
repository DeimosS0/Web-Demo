"""Fetch game genres from Steam Store API and save to genres.json."""
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"
INDEX_PATH = DATA_DIR / "index.json"
GENRES_PATH = DATA_DIR / "genres.json"

STEAM_API = "https://store.steampowered.com/api/appdetails?appids={}&l=turkish"

# Genre name translations (Steam sometimes returns English)
TR_GENRES = {
    "Action": "Aksiyon",
    "Adventure": "Macera",
    "RPG": "RPG",
    "Strategy": "Strateji",
    "Simulation": "Simülasyon",
    "Indie": "Bağımsız",
    "Casual": "Gündelik",
    "Racing": "Yarış",
    "Sports": "Spor",
    "Puzzle": "Bulmaca",
    "Platformer": "Platform",
    "Shooter": "Nişancı",
    "Fighting": "Dövüş",
    "Survival": "Hayatta Kalma",
    "Horror": "Korku",
    "Open World": "Açık Dünya",
    "Stealth": "Gizlilik",
    "Narrative": "Hikaye",
    "Exploration": "Keşif",
}


def fetch_genres(app_id: str) -> list[str]:
    """Fetch genre list for a single Steam app."""
    url = STEAM_API.format(app_id)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MakineWeb/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        info = data.get(app_id, {})
        if not info.get("success"):
            return []
        details = info.get("data", {})
        genres = [g["description"] for g in details.get("genres", [])]
        # Translate if English
        return [TR_GENRES.get(g, g) for g in genres]
    except (urllib.error.URLError, json.JSONDecodeError, KeyError, TimeoutError):
        return []


def main():
    with open(INDEX_PATH, encoding="utf-8") as f:
        catalog = json.load(f)

    # Load existing genres to resume
    existing: dict[str, list[str]] = {}
    if GENRES_PATH.exists():
        with open(GENRES_PATH, encoding="utf-8") as f:
            existing = json.load(f)

    app_ids = list(catalog["packages"].keys())
    total = len(app_ids)
    result = dict(existing)

    pending = [aid for aid in app_ids if aid not in result]
    print(f"Total: {total}, Already fetched: {len(existing)}, Remaining: {len(pending)}")

    for i, app_id in enumerate(pending, 1):
        name = catalog["packages"][app_id]["name"]
        genres = fetch_genres(app_id)
        result[app_id] = genres
        status = ", ".join(genres) if genres else "—"
        print(f"[{i}/{len(pending)}] {name}: {status}")

        # Save progress every 10 fetches
        if i % 10 == 0:
            with open(GENRES_PATH, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

        # Rate limit: 1 request per 1.5s (Steam limits ~200/5min)
        time.sleep(1.5)

    # Final save
    with open(GENRES_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    filled = sum(1 for v in result.values() if v)
    print(f"\nDone! {filled}/{total} games have genre data.")
    print(f"Saved to {GENRES_PATH}")


if __name__ == "__main__":
    main()

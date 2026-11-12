"""Startup benchmark: process start → /api/health → first page of assets → grid on screen.

    python tools/bench_startup.py                       # source launch, synthetic 2,000-image library
    python tools/bench_startup.py --home ~/.sight       # on a COPY of a real library (never the live one)
    python tools/bench_startup.py --exe dist/Sight/Sight.exe --runs 5

Each run starts Sight with --no-browser on a free port in an isolated SIGHT_HOME, then (unless
--no-browser) opens the UI in an off-screen Edge / Chrome / Chromium and waits for the first card.
Prints the median / min / max of every step. Window placement, maximize / focus and the splash are
Windows launcher behaviour this bench does not see (it opens no app window) — check them by hand.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchlib as B  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--home", help="SIGHT_HOME to copy and measure on (default: a synthetic library)")
    ap.add_argument("--exe", help="a built Sight executable instead of Sight.py")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--images", type=int, default=2000, help="size of the synthetic library")
    ap.add_argument("--no-browser", action="store_true", help="server only, no UI timing")
    args = ap.parse_args()

    browser_exe = None if args.no_browser else B.find_browser()
    if not args.no_browser and not browser_exe:
        print("no Edge / Chrome / Chromium found: measuring the server only")
    with B.isolated_home(args.home) as home:
        if not args.home:
            media = home.parent / "media"
            print(f"making a synthetic library of {args.images} images…")
            B.make_images(media, args.images)
            proc, base, _ = B.start_sight(home, args.exe)
            try:
                B.api(base, "/api/sources", {"path": str(media)})
                while B.api(base, "/api/state").get("scanning") or B.api(base, "/api/assets?limit=1")["total"] < args.images:
                    time.sleep(0.2)
            finally:
                B.stop(proc)
        health, first, grid = [], [], []
        browser = B.Browser(browser_exe) if browser_exe else None
        try:
            for i in range(args.runs):
                proc, base, ms = B.start_sight(home, args.exe)
                try:
                    health.append(ms)
                    t = time.perf_counter()
                    B.api(base, "/api/assets?limit=400")
                    first.append(ms + (time.perf_counter() - t) * 1000)
                    if browser:
                        page = browser.page()
                        t = time.perf_counter()
                        page.send("Page.navigate", url=base + "/")
                        B.wait_js(page, "document.querySelector('.card .thumb img') && document.querySelector('.card .thumb img').complete")
                        grid.append(ms + (time.perf_counter() - t) * 1000)
                        page.send("Page.navigate", url="about:blank")
                finally:
                    B.stop(proc)
                time.sleep(0.3)
        finally:
            if browser:
                browser.close()
    print("process start → /api/health     ", B.summary(health))
    print("            → first asset page  ", B.summary(first))
    if grid:
        print("            → first card shown  ", B.summary(grid), "(server start + page load in a warm browser)")


if __name__ == "__main__":
    main()

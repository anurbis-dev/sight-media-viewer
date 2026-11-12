"""Grid scrolling benchmark in an off-screen Edge / Chrome / Chromium.

    python tools/bench_grid.py                      # synthetic 3,000-image library
    python tools/bench_grid.py --home ~/.sight      # on a COPY of a real library (never the live one)

1. Wheel-scrolls the grid through the DevTools protocol (real input events, like a mouse) and
   samples every frame: frame time, and "blank" cards — cards on screen whose thumbnail is not
   painted yet. Reports blank frames (frames with any blank card) and the frame-time spread.
2. Steps `scrollTop` by 3 px per frame and checks it reads back unchanged on the next frame: the
   browser must never move the grid on its own (the 0.15.5 scroll-anchoring flip — `.grid` has
   `overflow-anchor: none`).
Thumbnails are generated on the first pass, so --warm (default) scrolls once before measuring.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchlib as B  # noqa: E402

SAMPLER = r"""
(() => {
  const g = document.querySelector(".grid");
  const out = window.__bench = { frames: [], blank: 0, done: false };
  let last = performance.now();
  function blankCards(){
    const r = g.getBoundingClientRect();
    let n = 0;
    for (const c of document.querySelectorAll(".grid .card")){
      const b = c.getBoundingClientRect();
      if (b.bottom < r.top || b.top > r.bottom) continue;
      const img = c.querySelector(".thumb img");
      if (!img || !img.complete || !img.naturalWidth) n++;
    }
    return n;
  }
  function f(now){
    if (out.done) return;
    out.frames.push([now - last, blankCards()]);
    last = now;
    requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
})()
"""

DRIFT = r"""
new Promise((ok) => {
  const g = document.querySelector(".grid");
  g.scrollTop = 0;
  let want = 0, bad = 0, n = 0;
  function f(){
    if (Math.abs(g.scrollTop - want) > 1) bad++;
    want = Math.min(g.scrollHeight - g.clientHeight, want + 3);
    g.scrollTop = want;
    if (++n < 600 && want < g.scrollHeight - g.clientHeight) requestAnimationFrame(f); else ok({ frames: n, moved: bad });
  }
  requestAnimationFrame(f);
})
"""


def wheel(page, x: int, y: int, dy: int, n: int, gap: float) -> None:
    for _ in range(n):
        page.send("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=dy)
        time.sleep(gap)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--home", help="SIGHT_HOME to copy and measure on (default: a synthetic library)")
    ap.add_argument("--exe", help="a built Sight executable instead of Sight.py")
    ap.add_argument("--images", type=int, default=3000)
    ap.add_argument("--steps", type=int, default=120, help="wheel events per pass")
    ap.add_argument("--no-warm", action="store_true", help="measure the first (cold thumbnail) pass")
    ap.add_argument("--passes", type=int, default=2, help="warm-up passes before measuring")
    args = ap.parse_args()
    exe = B.find_browser()
    if not exe:
        sys.exit("needs Edge, Chrome or Chromium")
    with B.isolated_home(args.home) as home:
        proc, base, _ = B.start_sight(home, args.exe)
        browser = B.Browser(exe)
        try:
            if not args.home:
                media = home.parent / "media"
                print(f"making a synthetic library of {args.images} images…")
                B.make_images(media, args.images)
                B.api(base, "/api/sources", {"path": str(media)})
                while B.api(base, "/api/state").get("scanning") or B.api(base, "/api/assets?limit=1")["total"] < args.images:
                    time.sleep(0.2)
            page = browser.page()
            page.send("Page.navigate", url=base + "/")
            B.wait_js(page, "document.querySelectorAll('.grid .card').length > 10")
            B.wait_js(page, "!document.querySelector('.grid .card .thumb img') || document.querySelector('.grid .card .thumb img').complete", 60)
            box = page.eval("(() => { const r = document.querySelector('.grid').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()", False)
            x, y = int(box[0]), int(box[1])
            if not args.no_warm:
                # Once down the whole pass (slowly, so every thumbnail is made) and back to the top.
                for _ in range(args.passes):
                    wheel(page, x, y, 400, args.steps, 0.05)
                    time.sleep(1.5)
                    page.eval("document.querySelector('.grid').scrollTop = 0", False)
                    time.sleep(0.5)
                page.eval("document.querySelector('.grid').scrollTop = 0", False)
                time.sleep(1.0)
            page.eval(SAMPLER, False)
            wheel(page, x, y, 400, args.steps, 0.016)
            time.sleep(0.5)
            frames = page.eval("(() => { window.__bench.done = true; return window.__bench.frames; })()", False)
            drift = page.eval(DRIFT)
        finally:
            browser.close()
            B.stop(proc)
    ft = sorted(f[0] for f in frames[1:])
    blank = [f for f in frames if f[1]]
    print(f"wheel pass: {len(frames)} frames, {len(blank)} with blank cards ({len(blank) / max(1, len(frames)) * 100:.0f} %), "
          f"most blank cards in one frame: {max((f[1] for f in frames), default=0)}")
    if ft:
        print(f"frame time: median {ft[len(ft) // 2]:.1f} ms, p95 {ft[int(len(ft) * 0.95)]:.1f} ms, max {ft[-1]:.1f} ms"
              " (headless: frames are paced by the browser, so read these relative to each other)")
    print(f"scrollTop drift check: {drift['moved']} of {drift['frames']} frames moved on their own"
          + ("" if drift["moved"] == 0 else "  <-- the browser is re-anchoring the grid"))
    print(json.dumps({"frames": len(frames), "blank_frames": len(blank), "drift_moved": drift["moved"]}))


if __name__ == "__main__":
    main()

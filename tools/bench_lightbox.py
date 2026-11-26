"""Lightbox timings in an off-screen Edge / Chrome / Chromium (R0-0, docs/PLAN-coreline.md): run it before and after
each R0 block on the same machine.

    python tools/bench_lightbox.py                       # synthetic media (4000 x 3000 JPEGs, a 1080p H.264 clip)
    python tools/bench_lightbox.py --home ~/.sight       # on a COPY of a real library (never the live one):
                                                         # its first images / videos, or --image / --video names

Measured with real input (DevTools Input.* events), timed inside the page (performance.now):
- open image: double-click on a tile → the full picture decoded and shown (the thumbnail placeholder gone);
  "(cold)" is a file's first open, before the browser's memory cache holds it;
- next image: → in the lightbox → the next picture shown (only where the grid's next tile is a picture);
- open video: double-click → the first frame presented (requestVideoFrameCallback);
- frame step: . (paused) → the new frame presented;
- close: Esc → the lightbox removed (it fades out for ~220 ms by design).
Headless timings (software decoding / WebGL) are noisy and do not stand for a Windows desktop: compare runs, not
machines.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchlib as B  # noqa: E402

KEYS = {"Period": (".", 190), "ArrowRight": ("ArrowRight", 39), "Escape": ("Escape", 27), "Space": (" ", 32)}


def key(page, code: str) -> None:
    k, vk = KEYS[code]
    for t in ("keyDown", "keyUp"):
        page.send("Input.dispatchKeyEvent", type=t, code=code, key=k, windowsVirtualKeyCode=vk, nativeVirtualKeyCode=vk)


def dblclick(page, x: float, y: float) -> None:
    for n in (1, 2):
        page.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=n)
        page.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=n)


def mark(page) -> None:
    page.eval("window.__t0 = performance.now()", await_promise=False)


def until(page, cond: str, timeout_ms: int = 30000) -> float:
    """ms from the last mark() until `cond` holds (checked every animation frame)."""
    return page.eval(f"""new Promise((ok, bad) => {{
      const end = performance.now() + {timeout_ms};
      (function f(){{
        let v = false; try {{ v = {cond}; }} catch {{}}
        if (v) ok(performance.now() - window.__t0);
        else if (performance.now() > end) bad(new Error("timeout"));
        else requestAnimationFrame(f);
      }})();
    }})""")


IMG_SHOWN = ("(() => { const m = document.querySelector('.light img.view-media'); return m && m.complete && m.naturalWidth > 0"
             " && !m.classList.contains('loading') && !document.querySelector('.light .view-ph'); })()")
NAME = "document.querySelector('.light .light-bar .t')?.textContent"


def card_center(page, aid: str):
    return page.eval(f"""(() => {{ const c = document.querySelector('.card[data-id="{aid}"]'); c.scrollIntoView({{block: 'center'}});
      const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()""", await_promise=False)


def video_frame_promise(page) -> None:
    """Arms window.__vf: resolves (ms since the mark) at the next presented frame of the lightbox video."""
    page.eval("""window.__vf = new Promise((ok) => {
      const go = () => { const v = document.querySelector('.light video.view-media');
        if (!v || !v.requestVideoFrameCallback) return requestAnimationFrame(go);
        v.requestVideoFrameCallback(() => ok(performance.now() - window.__t0)); };
      go(); })""", await_promise=False)


def make_media(folder: Path, images: int) -> None:
    from PIL import Image, ImageDraw  # Sight's own dependency

    folder.mkdir(parents=True, exist_ok=True)
    for i in range(images):
        im = Image.new("RGB", (4000, 3000), ((i * 37) % 256, (i * 91) % 256, (i * 53) % 256))
        d = ImageDraw.Draw(im)
        for k in range(0, 4000, 50):
            d.line([(k, 0), (4000 - k, 3000)], fill=((k * 7) % 256, 120, (k * 3) % 256), width=3)
        im.save(folder / f"img_{i:03d}.jpg", quality=88)
    ff = shutil.which("ffmpeg")
    if not ff:
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ff = None
    if ff:
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
                        "testsrc2=size=1920x1080:rate=25:duration=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "50",
                        str(folder / "clip_1080p.mp4")], check=True, timeout=300)
    else:
        print("(no ffmpeg: video timings skipped)")


def pick(assets: list[dict], kind: str, names: list[str], n: int) -> list[dict]:
    mine = [a for a in assets if a.get("kind") == kind and a.get("status") != "missing" and a.get("ext") != ".psd"]
    if names:
        return [a for a in mine if a["name"] in names or a["id"] in names]
    return mine[:n]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--home", help="a Sight home to copy and measure on (the copy is thrown away)")
    ap.add_argument("--exe", help="a built Sight executable instead of Sight.py")
    ap.add_argument("--browser", help="the browser to drive (default: the one Sight opens)")
    ap.add_argument("--image", action="append", default=[], help="an image (name or id) to open; repeatable")
    ap.add_argument("--video", action="append", default=[], help="a video (name or id) to open; repeatable")
    ap.add_argument("--images", type=int, default=6, help="synthetic images (no --home) / images picked")
    ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--steps", type=int, default=20, help="frame steps per round")
    args = ap.parse_args()
    exe = args.browser or B.find_browser()
    if not exe:
        sys.exit("No Edge / Chrome / Chromium found (pass --browser).")
    keys = ("open image (cold)", "open image", "next image (cold)", "next image", "open video (cold)", "open video",
            "frame step", "close")
    res: dict[str, list[float]] = {k: [] for k in keys}
    with B.isolated_home(args.home) as home:
        proc, base, _ = B.start_sight(home, args.exe)
        browser = None
        try:
            if not args.home:
                media = home / "bench-media"
                make_media(media, args.images)
                want = args.images + (1 if (media / "clip_1080p.mp4").exists() else 0)
                B.api(base, "/api/sources", {"path": str(media)})
                deadline = time.time() + 300
                while B.api(base, "/api/assets?limit=1").get("total", 0) < want or B.api(base, "/api/state").get("scanning"):
                    if time.time() > deadline:
                        sys.exit("the synthetic library was not scanned in time")
                    time.sleep(0.2)
            assets = B.api(base, "/api/assets?limit=2000").get("items", [])
            browser = B.Browser(exe)
            page = browser.page()
            page.send("Page.navigate", url=base + "/")
            B.wait_js(page, "document.querySelector('.card[data-id]')", 60)
            time.sleep(1.0)
            # Only tiles the grid has rendered (it is virtualised, and sorted by the library's own setting).
            shown = page.eval("[...document.querySelectorAll('.card[data-id]')].map((c) => c.dataset.id)", await_promise=False)
            by_id = {a["id"]: a for a in assets}
            in_grid = [by_id[i] for i in shown if i in by_id]
            imgs = pick(in_grid, "image", args.image, args.images)
            vids = pick(in_grid, "video", args.video, 1)
            if not imgs and not vids:
                sys.exit("none of the asked files is on the grid's first screen (pass --image / --video names that are)")
            warmed: set[str] = set()
            missed = 0
            order = page.eval("[...document.querySelectorAll('.card[data-id]')].map((c) => c.dataset.id)", await_promise=False)
            img_ids = {a["id"] for a in assets if a.get("kind") == "image" and a.get("ext") != ".psd"}
            names = {a["id"]: a["name"] for a in assets}
            for rnd in range(args.rounds):
                for k, a in enumerate(imgs):
                    # "(cold)": the very first open of a file, before the browser's memory cache holds it (the
                    # step to the next file below warms that one, so only round 0's opens of files no step has
                    # shown count as cold)
                    i = order.index(a["id"]) if a["id"] in order else -1
                    nxt = order[i + 1] if 0 <= i < len(order) - 1 and order[i + 1] in img_ids else None
                    x, y = card_center(page, a["id"])
                    mark(page)
                    dblclick(page, x, y)
                    ms = until(page, IMG_SHOWN)
                    res["open image" + (" (cold)" if rnd == 0 and a["id"] not in warmed else "")].append(ms)
                    warmed.add(a["id"])
                    if nxt:  # only towards a picture (a video / model / last tile has no picture to wait for)
                        mark(page)
                        key(page, "ArrowRight")
                        ms = until(page, f"{NAME} === {names[nxt]!r} && {IMG_SHOWN}")
                        res["next image" + (" (cold)" if nxt not in warmed else "")].append(ms)
                        warmed.add(nxt)
                    mark(page)
                    key(page, "Escape")
                    res["close"].append(until(page, "!document.querySelector('.light')"))
                for a in vids:
                    x, y = card_center(page, a["id"])
                    mark(page)
                    video_frame_promise(page)
                    dblclick(page, x, y)
                    res["open video" + (" (cold)" if a["id"] not in warmed else "")].append(page.eval("window.__vf"))
                    warmed.add(a["id"])
                    B.wait_js(page, "!document.querySelector('.light video.view-media').paused")  # autoplay started
                    key(page, "Space")  # pause
                    B.wait_js(page, "document.querySelector('.light video.view-media').paused")
                    for _ in range(args.steps):
                        B.wait_js(page, "!document.querySelector('.light video.view-media').seeking")
                        mark(page)
                        video_frame_promise(page)
                        key(page, "Period")
                        ms = page.eval("Promise.race([window.__vf, new Promise((ok) => setTimeout(() => ok(null), 5000))])")
                        if ms is None:  # no new frame presented (e.g. the step was clamped at the clip's end)
                            missed += 1
                        else:
                            res["frame step"].append(ms)
                    key(page, "Escape")
                    B.wait_js(page, "!document.querySelector('.light')")
        finally:
            if browser:
                browser.close()
            B.stop(proc)
    if missed:
        print(f"({missed} frame steps presented no new frame within 5 s: not counted)")
    for k, v in res.items():
        if v:
            print(f"{k:<18}", B.summary(v))


if __name__ == "__main__":
    main()

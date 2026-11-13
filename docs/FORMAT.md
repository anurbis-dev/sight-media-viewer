# Review format — `sight-review`, version 1

The data contract shared by Sight, the HTML reviewer page, the mobile app (docs/PLAN-mobile.md)
and the owner's tracker. Sight stores the same rows in its `annotations` table; a `.srev` file is
those rows plus the media's identity and the pictures. Code that reads or writes this data:
`app/review.py` (`build_package`, `parse_package`), `app/library.py` (`import_annotations` and
friends — the reference merge), `app/static/review-core.js` (rendering + the JS port of the merge),
`app/static/annotate.js` (Sight's editor), `mobile/js/model.js` (the phone app: every row it
writes, the package it builds / merges).

## Rules for changing the format

- `version` is **1**. Adding an optional field is not a version change: every reader ignores
  fields it does not know and keeps them when it rewrites a row (Sight stores `data` as is).
- Bump `version` only when an older reader would *misread* a file (a field changes meaning, a
  required field goes away). Sight refuses packages with a newer version ("made by a newer Sight").
- Any change to the merge rules is made in `Library.import_annotations` **and** `mergeRows` in
  `review-core.js` together; `tests/test_merge_parity.py` runs both on
  `tests/fixtures/merge_cases.json` (add a case for the new rule).
- Every new field gets a line here, with what older clients do with it.

## Conventions

- **Ids**: 16 lower-case hex chars (64 random bits), made by the client that creates the thing —
  rows, replies, status events, shots and 3D view keys. A client never re-uses an id for something
  else, so the same id is the same object on every machine.
- **Stamps**: integer milliseconds since the Unix epoch (`Date.now()`). Missing / `0` / not a number
  reads as 0. Clock skew between machines decides ties; accepted.
- **Doc units** (all drawing geometry): image / video / PSD → pixels of the media at native size,
  origin top-left. 3D → the viewer's screen space normalised to **1000 units high**, origin at the
  centre, y down (the perspective camera keeps its vertical fov, so this holds at any window
  size). Line widths and sizes are doc units too (the editor converts its screen-px tool sizes on
  creation).
- Colours are CSS hex strings (`#rrggbb`); opacities 0…1.

## Package (`.srev`, legacy `.sightreview`)

UTF-8 JSON (a BOM is accepted on import).

| Key | Type | |
|-----|------|--|
| `format` | `"sight-review"` | required; import checks this, not the file extension |
| `version` | `1` | required |
| `app` | string | who wrote it, e.g. `"Sight 0.20.0"`, `"Sight 0.20.0 (web reply)"`, `"Sight Review 0.23.0 (phone)"` |
| `exported_at` | stamp | |
| `author` | string | the sender's reviewer name |
| `asset` | object | media identity, see below; required |
| `annotations` | array of rows | required |
| `deleted` | `[{id, deleted_at}]` | tombstones of rows deleted on the sending side (since 0.17; older Sight ignores it) |
| `shots` | `{shotId: dataURL}` | pictures referenced by notes / replies (`data:image/jpeg;base64,…` or PNG) |

### Asset identity

`asset = {id, name, path, ext, kind, size, mtime, width, height, duration}` — `id` is Sight's
asset id (a hash of the file's path on the exporting machine; the phone app writes its own key, a
hash of name + size, with `path` = the name, unless the review came from Sight), `kind` is `image` | `video` |
`audio` | `model3d` | …, `ext` like `.png`, `size` in bytes, `width` / `height` in pixels (null
when unknown), `duration` in seconds.

Import finds the media in this order: the same `id` (same path), then the asset that already holds
most of the package's row ids (an earlier import of the same review), then the same `name` +
`size`, then the same `name` + `kind`. No match → the user is told which file is missing.

**Versions** are not listed in the package. Sight finds them itself: files in the same folder
whose names only differ in the last `v` / `ver` / `version` / `rev` / `r` + digits token
(`Library.asset_versions` / `version_key`; images, PSD, video). A note copied from the previous
version carries `data.from` (below).

## Rows

One row per object; the same shape in the package and (plus Sight-only columns) in the table.

| Key | |
|-----|--|
| `id` | row id |
| `kind` | `note` · `stroke` · `shape` · `text` · `pin` · `status` |
| `shape_kind` | `stroke`: `brush` · `pencil` · `marker`; `shape`: `rect` · `ellipse` · `line` · `arrow`; else null |
| `x` `y` `w` `h` | the drawing's bounding box in doc units — for queries only, the geometry is in `data`; null for notes / status |
| `rotation`, `z_index` | `z_index` = paint order (higher on top); `rotation` stays 0 (rotation lives in `data.rot`) |
| `color` | the drawing's main colour (copy of `data.color`), or null |
| `locked` | 0 / 1, unused so far |
| `data` | the object itself, per kind below |
| `created_at`, `updated_at` | stamps; `updated_at` changes on every edit of the row |

Sight's table also has `scope` (`asset`), `target_asset_id`, `revision` and `deleted_at` (a deleted
row is a tombstone: kept with `deleted_at` set); they are not written into packages.

### `note` — a review comment

```
data = {
  text, author, created,              // created: stamp
  status: "open" | "progress" | "done",
  status_at?,                         // stamp of the last state change (merge key for status)
  edited_at?,                         // stamp of the last text / shots edit (merge key for content)
  ctx,                                // where it sits, see Context (3D notes add ctx.v3d)
  shots: [shotId],                    // attached pictures (screenshots, uploads)
  replies?: [reply | event],          // the thread, oldest first
  from?: {id, asset, name}            // copied from note `id` on the previous version `asset`
}
```

`progress` appeared in 0.19; older Sight shows such a note as open. "Open notes" (counts,
carry-over, the report's *Open*) means status ≠ `done`.

**Reply**: `{id, text, author, created, edited?, shots?: [shotId]}` — `edited` is stamped on a
change of its text or pictures (the phone app since 0.32 keeps it past the reply's own stamp); the
reply merges as one unit (the later `edited` keeps its text *and* pictures), its drawings as rows of
their own. Deleted:
`{id, created, deleted: stamp}` — a tombstone that stays in the list so an older copy cannot bring
the reply back. Reply pictures appeared in 0.19 (older Sight ignores `shots` on a reply).

**Status event** (thread log of state changes, 0.18+): `{id, event: "progress" | "done" | "open",
author, created}`. Never edited or deleted. The note's real state is still `status` / `status_at`;
events are only the history. Older Sight shows an event as an empty reply.

### Drawings — `stroke`, `shape`, `text`, `pin`

Common `data` keys:

| Key | |
|-----|--|
| `note` | id of the note the drawing belongs to, or null (drawn, not attached yet) |
| `reply` | **0.20+**: id of the reply (in that note's `replies`) the drawing was made with. The drawing also keeps `data.note`. Sight hides it when the reply is deleted and while the reply's eye toggle is off, and deletes it together with the reply; older Sight just shows it as a note drawing. |
| `ctx` | Context, below |
| `created` | stamp |
| `opacity` | 0…1 (default 1; marker 0.4) |

Per type (all lengths in doc units):

- **`stroke` brush / pencil**: `pts: [x, y, pressure, x, y, pressure, …]` (pressure 0…1, 0.5 for
  mouse input), `color`, `size` (full width at pressure 1), `pen` (true = pressure was recorded),
  `pressure` (false = draw at constant width even with a pen). Rendered as a filled outline from
  per-point radii: pen → `size/2 · (lo + (1 − lo)·p)` with lo = 0.12 brush, 0.45 pencil; mouse
  brush → a short taper at both ends; mouse pencil → constant.
- **`stroke` marker** (highlighter): same `pts`, `color`, `size` = stroke width; a round-capped
  stroked path, default opacity 0.4.
- **`shape` rect / ellipse**: `x, y, w, h` (box, may be negative before normalising), `rot`
  (degrees about the box centre), `strokeOn`, `color`, `width`, `dash` `solid` | `dashed` |
  `dotted`, `fillOn`, `fill`, `fillOpacity`, `radius` (rect corners).
- **`shape` line / arrow**: `pts: [x1, y1, x2, y2]`, `color`, `width`, `dash`, `head0` / `head1`
  (start / end) `none` | `triangle` | `open` | `diamond` | `dot` | `bar`, `headSize` (×), `body`
  `straight` | `curve` | `elbow`, `bend` (curve: signed offset of the apex from the chord's
  midpoint; default a quarter of the length). `arrow` and `line` differ only in defaults.
- **`text`**: `text` (lines split by `\n`), `x, y` (top-left of the first line), `font` `sans` |
  `serif` | `mono` | `hand` | `impact`, `size` (px of the font), `color`, `bold`, `italic`,
  `underline`, `align` `left` | `center` | `right`, `bgOn`, `bg`, `bgOpacity` (box behind the text,
  padding 0.3·size), `outline` (width), `outlineColor`, `rot`. Line height 1.25·size.
- **`pin`**: `x, y` (centre), `color`, `size` (diameter). Shows the number of its note.

The exact rendering (primitives, SVG and canvas) is `primsOf` / `primSvg` / `primCanvas` in
`review-core.js`; every client draws through it, so a drawing looks the same everywhere.

### Context — `data.ctx`

- Image / PSD: `null` — always visible.
- Video: `{t, hold}` — the frame at `t` seconds; visible from `t` for `max(hold, one frame)`
  seconds; `hold: -1` = the whole clip. Notes take the same `{t, hold}`.
- 3D: `{vk, cam: {p: [x, y, z], t: [x, y, z], fov, turns}}` — `vk` is the view key (all drawings
  of one camera view share it), `cam` the camera position, orbit target, vertical fov (degrees)
  and the model's quarter-turn count. A drawing shows only while the live camera matches its view
  (within 0.4 % of the camera distance). A note's ctx also carries `v3d` — the viewer settings
  (shading, lights, explode, fov) it was written with, restored when the note is opened.
  **0.41+:** a 3D ctx may carry `hidden` — the indices (ascending) of the model's meshes hidden in that
  view, in the viewer's mesh order. A view matches only with the same hidden set (an absent `hidden`, a
  file from before 0.41, matches any). `[]` = nothing hidden.
  **0.42+:** a 3D ctx may carry `explode` — the explode amount (0–1) the row was made at. Optional: rows from
  before 0.42 have none, and an absent `explode` is not "0". A view's explode is the newest such value among its
  rows, and the slider's last value at the view for this session (not stored in the file) — but the slider does
  not change a view that holds an added note or a drawing attached to one (0.44.1). A note's own pictures and
  exports use the `explode` of its own rows on that view (an older note, with none, uses the `v3d.explode` it was
  written with), so two notes on one view may show two amounts.
- A drawing made later on a note's frame (a reply's drawing on the HTML page / in the app) takes
  that note's place: video `{t, hold}` copied from the note, 3D `{vk, cam}` of the note's view; a
  new note drawn on another note's frame copies that note's whole `ctx`. **0.29+:** a reply on a
  video note in the phone app may also draw on frames the note is not on (each drawing keeps its
  own `{t, hold}`); readers place a reply's drawings by their own ctx, as any drawing, and treat
  those frames as the note's thread (Sight's export adds them to the note's extra frames). The rule for whether a
  context shows on a frame is `ctxVisible` in `review-core.js`.

### `status` — the file's review state

```
data = { state: "review" | "changes" | "approved" | null,   // null = cleared
         author, at,                                        // the latest change
         history: [{state, author, at}] }                   // every change, oldest first; state "" = cleared
```

The newest live status row wins (a merge can leave two; setting the state again retires the
others). Rows from 0.17.0 have no `history`: their current state counts as its only entry.

## Shots

Pictures live outside the rows: `data.shots` / `replies[].shots` list ids, the package's `shots`
map holds the bytes as data URLs (JPEG or PNG). Sight keeps them as files
`<SIGHT_HOME>/review_shots/<id>.jpg|png`. On import a hex id is kept (so importing the same file
twice stores each picture once); a non-hex id gets one derived from the picture's bytes and the
rows are remapped. The HTML page scales uploaded pictures to ≤ 1600 px JPEG.

## Merge rules

Merging a package into what a client holds (Sight: `Library.import_annotations`; JS:
`SightReviewCore.mergeRows`). The same input gives the same rows on every client.

1. Rows keep their ids (lower-cased). *Sight only:* an id that belongs to another asset, or is not
   hex, becomes a stable derived id (`sha1("anno-import:<asset>:<id>")[:16]`); `data.note` links
   follow. The JS port works on one asset and keeps ids.
2. A row that is new here is added (`created_at` = the incoming one, else its `updated_at`).
3. Otherwise the **content stamp** decides which copy's `data` and columns win: a note's
   `data.edited_at`, else `data.created`; any other row's `updated_at`. The incoming copy wins
   only if its stamp is **later** (a tie keeps the local copy). Notes deliberately ignore
   `updated_at`: a reply or a resolve bumps it, and a stale copy of the text must not win because
   someone answered it.
4. Whatever copy wins, for a **note**: the replies are the union of both lists by id — for the
   same id the later of `edited` (else `created`) / `deleted` wins; sorted by `created` — and
   `status` comes from the copy with the later `status_at` (no change on a tie). For a **status**
   row the `history` lists are unioned (same `at` + `state` + `author` = one entry, the local one
   kept), sorted by `at`.
5. A row **deleted here** comes back only if the incoming content stamp is later than the delete.
6. Each package tombstone deletes the local row if the tombstone is later than that row's content
   stamp.
7. Bookkeeping: an updated row gets `updated_at = max(now, old)` when only its replies / state /
   history changed, and the incoming `updated_at` (notes: `max(incoming, now)`) when the incoming
   copy won. A merge that changes nothing reports the row as unchanged.

So: a reply or a state change never makes a stale copy of the text win, and never revives a
deleted note; deletes travel as tombstones; nothing is lost when both sides edit different
things.

## Example

```json
{
  "format": "sight-review", "version": 1, "app": "Sight 0.20.0", "exported_at": 1790000000000, "author": "Ann",
  "asset": {"id": "1f0c2a9e5b7d4c31", "name": "shot_v002.png", "path": "D:/proj/shot_v002.png", "ext": ".png",
            "kind": "image", "size": 1843211, "mtime": 1789990000, "width": 1920, "height": 1080, "duration": null},
  "annotations": [
    {"id": "a1b2c3d4e5f60718", "kind": "note", "shape_kind": null, "x": null, "y": null, "w": null, "h": null,
     "rotation": 0, "z_index": 0, "color": null, "locked": 0, "created_at": 1790000000000, "updated_at": 1790000100000,
     "data": {"text": "Sky too dark", "author": "Ann", "created": 1790000000000, "status": "progress",
              "status_at": 1790000100000, "ctx": null, "shots": [],
              "replies": [{"id": "0f1e2d3c4b5a6978", "text": "Lifting it", "author": "Bob", "created": 1790000090000},
                          {"id": "99aa88bb77cc66dd", "event": "progress", "author": "Bob", "created": 1790000100000}]}},
    {"id": "5566778899aabbcc", "kind": "stroke", "shape_kind": "brush", "x": 97, "y": 37, "w": 206, "h": 86,
     "rotation": 0, "z_index": 1, "color": "#ff3b30", "locked": 0, "created_at": 1790000000000, "updated_at": 1790000000000,
     "data": {"color": "#ff3b30", "size": 6, "opacity": 1, "pressure": true, "pen": true,
              "pts": [100, 40, 0.4, 180, 90, 0.8, 300, 120, 0.3], "ctx": null,
              "note": "a1b2c3d4e5f60718", "reply": "0f1e2d3c4b5a6978", "created": 1790000090000}}
  ],
  "deleted": [{"id": "deadbeefdeadbeef", "deleted_at": 1790000050000}],
  "shots": {}
}
```

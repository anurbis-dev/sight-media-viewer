# Writes tests/fixtures/merge_cases.json — the merge fixtures shared by the Python and JS tests.
# Run: python tests/fixtures/make_merge_cases.py tests/fixtures/merge_cases.json
import json, sys
T0 = 1_790_000_000_000          # stamps in ms
NOW = 1_800_000_000_000         # the merge clock (multiple of 1000: Python patches time.time)
def i(n): return f"{n:016x}"
N1, N2, N3, D1, D2, D3, S1, R1, R2, R3, E1 = (i(0xa0 + k) for k in range(11))

def note(id_, text, created, *, edited=None, status="open", status_at=None, replies=None, shots=None, upd=None, **kw):
    d = {"text": text, "author": "Ann", "created": created, "status": status, "ctx": None, "shots": shots or []}
    if edited: d["edited_at"] = edited
    if status_at: d["status_at"] = status_at
    if replies is not None: d["replies"] = replies
    d.update(kw)
    return {"id": id_, "kind": "note", "shape_kind": None, "x": None, "y": None, "w": None, "h": None,
            "rotation": 0, "z_index": 0, "color": None, "data": d, "locked": 0,
            "created_at": created, "updated_at": upd or created}

def stroke(id_, note_id, pts, upd, created=None, sub="brush", **kw):
    d = {"color": "#ff3b30", "size": 6, "opacity": 1, "pressure": True, "pen": True, "pts": pts,
         "ctx": None, "note": note_id, "created": created or T0}
    d.update(kw)
    xs, ys = pts[0::3], pts[1::3]
    return {"id": id_, "kind": "stroke", "shape_kind": sub, "x": min(xs) - 3, "y": min(ys) - 3,
            "w": max(xs) - min(xs) + 6, "h": max(ys) - min(ys) + 6, "rotation": 0, "z_index": 2,
            "color": "#ff3b30", "data": d, "locked": 0, "created_at": created or T0, "updated_at": upd}

def rect(id_, note_id, x, y, w, h, upd, created=None):
    return {"id": id_, "kind": "shape", "shape_kind": "rect", "x": x - 2, "y": y - 2, "w": w + 4, "h": h + 4,
            "rotation": 0, "z_index": 1, "color": "#34c759",
            "data": {"color": "#34c759", "strokeOn": True, "width": 4, "dash": "solid", "fillOn": False, "fill": "#34c759",
                     "fillOpacity": 0.2, "radius": 0, "opacity": 1, "x": x, "y": y, "w": w, "h": h, "rot": 0,
                     "ctx": {"t": 1.5, "hold": 0}, "note": note_id, "created": created or T0},
            "locked": 0, "created_at": created or T0, "updated_at": upd}

def rep(id_, text, created, author="Bob", **kw):
    r = {"id": id_, "text": text, "author": author, "created": created}
    r.update(kw)
    return r

def gone(row, at):
    return {**row, "deleted_at": at}

cases = []
def case(name, local, incoming, deleted=None, shot_map=None, now=NOW):
    cases.append({"name": name, "now": now, "local": local, "incoming": incoming,
                  "deleted": deleted or [], "shot_map": shot_map or {}})

# 1. Everything new: a note, its drawing, a drawing on one of its replies (data.reply).
case("new rows are added",
     [],
     [note(N1, "Too dark", T0, replies=[rep(R1, "Fixed?", T0 + 10)]),
      stroke(D1, N1, [10, 10, .5, 40, 30, .8, 90, 35, .3], T0 + 1),
      stroke(D2, N1, [5, 5, .5, 6, 7, .5], T0 + 11, reply=R1, sub="pencil")])

# 2. Same file imported twice: nothing changes.
base = [note(N1, "Too dark", T0, replies=[rep(R1, "ok", T0 + 5)]), stroke(D1, N1, [1, 2, .5, 3, 4, .5], T0 + 1)]
case("identical import is unchanged", base, base)

# 3. Incoming text edited later wins; replies are unioned; the state goes by status_at.
case("later text edit wins, replies unioned",
     [note(N1, "Too dark", T0, replies=[rep(R1, "mine", T0 + 5, author="Ann")], status="done", status_at=T0 + 6, upd=T0 + 6)],
     [note(N1, "Too dark on the left", T0, edited=T0 + 20, replies=[rep(R2, "theirs", T0 + 3)], status="open", upd=T0 + 20)])

# 4. A reviewer's stale copy: newer reply + resolve come in, the older text does not.
case("stale text loses, new reply and state win",
     [note(N1, "Edited in Sight", T0, edited=T0 + 50, upd=T0 + 50)],
     [note(N1, "Original", T0, replies=[rep(R1, "done!", T0 + 60), {"id": E1, "event": "done", "author": "Bob", "created": T0 + 61}],
           status="done", status_at=T0 + 61, upd=T0 + 5)])

# 5. Same reply edited on both sides / deleted on one.
case("reply edit and delete stamps",
     [note(N1, "n", T0, replies=[rep(R1, "local edit", T0 + 1, edited=T0 + 30), rep(R2, "keep", T0 + 2),
                                  {"id": R3, "created": T0 + 3, "deleted": T0 + 40}])],
     [note(N1, "n", T0, replies=[rep(R1, "remote edit", T0 + 1, edited=T0 + 20), rep(R2, "keep", T0 + 2, edited=T0 + 25),
                                  rep(R3, "remote edit after?", T0 + 3, edited=T0 + 35)])])

# 6. Deleted here: an incoming copy not edited after the delete stays deleted; one edited after revives.
case("local delete beats older incoming, newer revives",
     [gone(note(N1, "gone", T0), T0 + 100), gone(stroke(D1, N1, [1, 1, .5], T0 + 1), T0 + 100),
      gone(note(N2, "gone too", T0), T0 + 100)],
     [note(N1, "gone", T0, replies=[rep(R1, "late reply", T0 + 200)]), stroke(D1, N1, [1, 1, .5], T0 + 50),
      note(N2, "rewritten later", T0, edited=T0 + 150, replies=[rep(R2, "r", T0 + 151)])])

# 7. Package tombstones delete rows not edited since; a row edited after the tombstone stays.
case("tombstones",
     [note(N1, "old", T0), stroke(D1, N1, [1, 1, .5, 2, 2, .5], T0 + 10), rect(D2, N1, 5, 5, 20, 10, T0 + 500),
      note(N2, "edited after", T0, edited=T0 + 900)],
     [],
     deleted=[{"id": N1, "deleted_at": T0 + 300}, {"id": D1, "deleted_at": T0 + 300},
              {"id": D2, "deleted_at": T0 + 300}, {"id": N2, "deleted_at": T0 + 300},
              {"id": N3, "deleted_at": T0 + 300}, {"id": "", "deleted_at": T0}, {"id": D3, "deleted_at": 0}])

# 8. Drawings go by updated_at: newer geometry wins (columns too), older loses.
case("drawings by updated_at",
     [rect(D1, N1, 0, 0, 10, 10, T0 + 10), rect(D2, N1, 0, 0, 10, 10, T0 + 90)],
     [rect(D1, N1, 50, 60, 30, 20, T0 + 20), rect(D2, N1, 1, 1, 1, 1, T0 + 40)])

# 9. Review state rows: history unioned (dupes by (at, state, author)), newest content wins.
case("status history union",
     [{"id": S1, "kind": "status", "shape_kind": None, "x": None, "y": None, "w": None, "h": None, "rotation": 0,
       "z_index": 0, "color": None, "locked": 0, "created_at": T0, "updated_at": T0 + 10,
       "data": {"state": "changes", "author": "Ann", "at": T0 + 10,
                "history": [{"state": "review", "author": "Ann", "at": T0, "via": "sight"}, {"state": "changes", "author": "Ann", "at": T0 + 10},
                            {"state": "review", "author": "Cy", "at": T0 + 10}]}}],
     [{"id": S1, "kind": "status", "shape_kind": None, "x": None, "y": None, "w": None, "h": None, "rotation": 0,
       "z_index": 0, "color": None, "locked": 0, "created_at": T0, "updated_at": T0 + 20,
       "data": {"state": "approved", "author": "Bob", "at": T0 + 20,
                "history": [{"state": "review", "author": "Ann", "at": T0, "via": "web"}, {"state": "", "author": "Bob", "at": T0 + 5},
                            {"state": None, "author": "Bob", "at": T0 + 5}, {"state": "approved", "author": "Bob", "at": T0 + 10},
                            {"state": "approved", "author": "Bob", "at": T0 + 20}]}}])

# 10. Screenshot ids renamed on import (review.put_shot), note and reply pictures alike.
case("shot map",
     [],
     [note(N1, "pics", T0, shots=["s1", "keep"], replies=[rep(R1, "see", T0 + 1, shots=["s2"]), "junk"])],
     shot_map={"s1": i(0xf1), "s2": i(0xf2)})

# 11. Upper-case hex ids are lower-cased, drawings follow their note's id.
case("ids are lower-cased",
     [],
     [note(N1.upper(), "caps", T0), stroke(D1.upper(), N1.upper(), [1, 1, .5], T0 + 1)])

# 12. Same content stamp: the local copy wins (ties); a new reply still merges.
case("tie keeps local text",
     [note(N1, "local", T0, edited=T0 + 5)],
     [note(N1, "remote", T0, edited=T0 + 5, replies=[rep(R1, "x", T0 + 6)])])

# 13. Loose shapes: no kind, string stamps, numbers as strings, replies not a list, no id.
case("loose values",
     [note(N2, "has replies", T0, replies=[rep(R1, "a", T0 + 1)])],
     [{"id": D1, "x": "12.5", "y": 3, "w": None, "rotation": None, "z_index": "4", "color": 7, "locked": True,
       "created_at": "1790000000500", "updated_at": None, "data": {"note": N2, "replies": {"x": 1}}},
      {"kind": "note", "data": {"text": "no id"}},
      note(N2, "has replies", T0, replies=None),
      {"id": D2, "kind": "pin", "shape_kind": None, "data": None}])

# 14. A note resolved on one side and reopened later on the other, plus a deleted row whose
#     incoming copy was edited after the delete in a drawing.
case("status_at both ways, drawing revived",
     [note(N1, "a", T0, status="done", status_at=T0 + 10), note(N2, "b", T0, status="progress", status_at=T0 + 50),
      gone(rect(D1, N1, 0, 0, 5, 5, T0 + 5), T0 + 20)],
     [note(N1, "a", T0, status="open", status_at=T0 + 30), note(N2, "b", T0, status="done", status_at=T0 + 40),
      rect(D1, N1, 9, 9, 5, 5, T0 + 25)])

# 15. The same id twice in one package: the second copy merges into the first.
case("duplicate ids in one package",
     [],
     [note(N1, "first", T0, replies=[rep(R1, "a", T0 + 1)]), note(N1, "second", T0, edited=T0 + 9, replies=[rep(R2, "b", T0 + 2)])])

json.dump(cases, open(sys.argv[1], "w"), indent=1)
print(len(cases), "cases")

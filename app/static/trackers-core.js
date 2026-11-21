// Trackers core — the tracker-neutral registry shared by Sight's page and the phone app (docs/ARCHITECTURE.md
// "Tracker adapters", docs/PLAN-trackers.md decision 11). Several trackers can be connected at once; the UI is one
// for all of them and talks to a tracker only through its **adapter** (one object per kind, e.g. ShotGrid's,
// defined in shotgrid-core.js). A tracker is its kind + its site; the **tracker key** "<kind>:<host>" files
// everything kept per tracker (sidebar source rows, smart collections, links) — the same rule as the server's
// app/trackers.py `tracker_key` (host lowercased, the default port dropped: URL.host).
//
// Adapters register themselves by pushing onto globalThis.SightTrackerAdapters (so the load order of the scripts
// does not matter); `SightTrackers.adapter(kind)` finds one. Plain script, no build step: one global `SightTrackers`
// (also module.exports under Node, for the tests). Sight: `import "/static/trackers-core.js"`; the phone app:
// <script src="core/trackers-core.js">.
//
// The adapter interface (what the UI uses; ShotGrid's is SightShotGrid.adapter):
//   id, name, short                      "shotgrid", "ShotGrid", "SG" (the review panel's button: short + " ▾")
//   media: {one, many}                   what its media entities are called ("Version", "Versions")
//   entityTypes: [[value, label]]        the browser bar's quick type filter ("" = all)
//   statusField                          the field the bar's status filter and the builder's "seen" values use
//   defaultTileFields: [name]            tile captions until the user picks (Fields ▾)
//   siteHost(site)                       the host a link and the review rows carry for that site (= the client's host;
//                                        a stored link is compared by it)
//   serverClient(site, kind)             a client for Sight's page: every request through Sight's server
//                                        (/api/trackers/<kind>/fetch?url=…), which holds the credentials
//   projects(client) -> [{id, name}]
//   entities(client, projectId, type) -> [{id, name}]       the bar's entity list for a quick type
//   mediaFields(client) -> [{name, label, type, values?, labels?}]   the media entity's schema fields (link fields
//                                        have type "entity" / "multi_entity")
//   filterFields(schema, {seen, tree})   the schema as Filter ▾ fields (SightFilter's field model)
//   toConditions(tree, fields)           Filter ▾'s tree in the tracker's own filter form (null: nothing to send)
//   browse(client, filter, fields, page, size, cond) -> [record]   a page of media entities, newest first;
//                                        filter = {project, type, entity, status, q}
//   recordId(rec), recordName(rec), recordStamp(rec), recordTime(rec)   id, display name, "changed" stamp (the
//                                        thumbnail cache), creation time in ms (0 unknown)
//   isVideo(rec), hasFilmstrip(rec), filmstripFrames(w), filmstripCss(frames, fx)
//   fmtField(rec, name) -> text          a field's value as tile / inspector text
//   hiddenDetailFields: [name]           fields the inspector never lists
//   findMedia(client, projectId, text) -> [record]   the review panel's search
//   loadLink(client, id) -> link         a link to one media entity (what a review is tied to)
//   linkOf(host, record) -> link         the same from a record already read
//   linkId(link), linkLabel(link), linkProject(link)
//   linkedIdOf(rows, host) -> id|null    the media entity a review's rows already name (synced by another client)
//   sync(o) -> result                    two-way notes sync of one review with its linked media entity
//   storeKey(name) -> string             where the page keeps a per-kind setting (ShotGrid: the pre-0.107 names)

var SightTrackers = (function(){
  "use strict";

  // 'https://Studio.example:443/' -> 'studio.example' (URL.host: no scheme = https, http(s) only, the hostname canonical
  // — IPv6 compressed, IPv4 as a dotted quad, punycode —, the scheme's default port dropped). app/trackers.py host_of
  // follows the same rule (tests/test_trackers.py compares them).
  function hostOf(site){
    var s = String(site == null ? "" : site).trim();
    if (!s) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
    try { var u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.host.toLowerCase() : ""; } catch (e){ return ""; }
  }
  function key(kind, siteOrHost){ var h = hostOf(siteOrHost); return kind && h ? kind + ":" + h : ""; }
  function split(k){
    var m = /^([a-z][a-z0-9_-]{0,31}):([\x21-\x7e]+)$/.exec(typeof k === "string" ? k : "");
    return m && m[2] === m[2].toLowerCase() ? { kind: m[1], host: m[2] } : null;
  }
  function list(){ var a = (typeof globalThis !== "undefined" && globalThis.SightTrackerAdapters) || []; return Array.isArray(a) ? a : []; }
  function adapter(kind){
    var l = list();
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].id === kind) return l[i];
    return null;
  }
  // The kinds this client can connect, in the order they were registered: [{id, name}].
  function kinds(){ return list().filter(function(a){ return a && a.id; }).map(function(a){ return { id: a.id, name: a.name }; }); }
  // A tracker entry (from /api/trackers or the phone's list) -> its adapter (null: a kind this client lacks).
  function adapterOf(t){ return t ? adapter(t.kind || t.id) : null; }

  return { hostOf: hostOf, key: key, split: split, adapter: adapter, adapterOf: adapterOf, kinds: kinds };
})();
if (typeof globalThis !== "undefined") globalThis.SightTrackers = SightTrackers;
if (typeof module === "object" && module && module.exports) module.exports = SightTrackers;

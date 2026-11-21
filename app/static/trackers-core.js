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
//   recordSub(rec) -> text               a record's second line in a pick list (ShotGrid: the Version's Shot / Asset)
//   sync(o) -> result                    two-way notes sync of one review with its linked media entity; o.settings = the
//                                        connection's settings (Sight: its status, the phone: the device's connection),
//                                        the adapter reads its own options from them (ShotGrid: statusMap, logins, sudo)
//   storeKey(name, app) -> string        where a per-kind setting is kept (ShotGrid: the pre-0.107 names). app "phone":
//                                        the phone's names (localStorage / Cache Storage), e.g. "connection", "filter",
//                                        "fields", "where", "project", "thumbs" (a cache name), "thumb" (its key prefix)
//   settings                             the declarative settings form (below; mountForm renders it in both apps)
// A device that holds the credentials itself (the phone; Sight's page goes through its server instead):
//   deviceClient(cfg)                    a client from the connection kept on the device (the settings form's values)
//   deviceHint(err, cfg) -> text         a hint appended to an error (ShotGrid: "set a proxy" for a CORS refusal)
//   deviceNote(cfg) -> text              the entry's note ("as reviewer"), like the server's /api/trackers note
//   pictureUrl(rec, which) -> url|null   which = "image" | "filmstrip": what the device downloads for a tile
//   mediaSource(rec, {still}) -> {url, name, type}|null   the playable media to download (still: a still is wanted)
//   download(client, url) -> Blob
//
// The settings form (adapter.settings) — Settings → Trackers in Sight (index.html) and the phone's settings sheet render
// it with the one renderer below (mountForm); what to do with the values (Sight: PUT /api/trackers/<kind>/config; the
// phone: kept on the device) is each app's:
//   fields: [field]                      in order. A field: {name, label, type, placeholder?, title?, apps?: ["sight" |
//                                        "phone"] (default both), input? (the <input> type), min?, step?, part? (Sight
//                                        renders a field with part "cache" in the media cache box, shown while
//                                        connected)}. Any text may be {sight, phone} for a per-app wording.
//                                        Types: text, secret (never shown back: has = the status flag saying one is
//                                        saved, keptWith = the fields it goes with — another value drops it, lostText),
//                                        checkbox, pairs ("Name = value" lines <-> an object), number (> 0, else 0),
//                                        custom (build(document, app) -> {el, get(), set(value)}, empty = its stored
//                                        value when unset: a section too specific for the types above)
//                                        clean? (the phone stores what it reads: e.g. the site normalised)
//   required: [name]                     connected = all of these set (the phone; Sight's server decides for itself)
//   needs                                the same in words ("site, script name and key")
//   intro: {phone}                       the phone sheet's paragraph
//   disconnectTitle, testTitle, saveError, cache: {clearTitle} (Sight: the media cache box)

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

  // ---- the settings form (adapter.settings, see the top) -------------------------------------------------------------
  function pick(v, app){ return v && typeof v === "object" && !Array.isArray(v) ? v[app] : v; }
  function formFields(a, app){
    var f = (a && a.settings && a.settings.fields) || [];
    return f.filter(function(x){ return x && x.name && (!x.apps || x.apps.indexOf(app) >= 0); });
  }
  function secretOf(a, app){ return formFields(a, app).filter(function(x){ return x.type === "secret"; })[0] || null; }
  // values from the form / the device -> connected? (every required field set)
  function formReady(a, v){ var r = (a && a.settings && a.settings.required) || []; return !!v && r.length > 0 && r.every(function(n){ return !!v[n]; }); }
  // A saved secret that went with fields now changed (another site / script): the server dropped it.
  function secretLost(a, app, before, after){
    var s = secretOf(a, app);
    if (!s || !before || !after || !s.has) return false;
    return !!before[s.has] && !after[s.has] && (s.keptWith || []).some(function(n){ return before[n] !== after[n]; });
  }
  // The stored values as a save body with the secret cleared (Disconnect: what is kept, without the key).
  function formStored(a, app, cur){
    var out = {};
    formFields(a, app).forEach(function(f){
      var v = cur ? cur[f.name] : undefined;
      if (f.type === "secret") out[f.name] = "";
      else if (f.type === "checkbox") out[f.name] = !!v;
      else if (f.type === "number") out[f.name] = Number(v) || 0;
      else if (f.type === "pairs") out[f.name] = v && typeof v === "object" ? v : {};
      else if (f.type === "custom") out[f.name] = v == null ? (f.empty === undefined ? null : JSON.parse(JSON.stringify(f.empty))) : v;
      else out[f.name] = v == null ? "" : String(v);
    });
    return out;
  }
  // mountForm(host, adapter, app, {parts: {name: element}}) renders the adapter's fields for `app` ("sight" | "phone")
  // into host (a field with `part` into parts[part], left out without one) and returns
  // {read() -> values (a secret only when typed), fill(values), focus(), input(name) -> element}.
  function mountForm(host, a, app, opts){
    var doc = host.ownerDocument, parts = (opts && opts.parts) || {}, ctl = {};
    function mk(tag, cls, text){ var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    formFields(a, app).forEach(function(f){
      var into = f.part ? parts[f.part] : host;
      if (!into) return;
      var label = pick(f.label, app) || f.name, title = pick(f.title, app), ph = pick(f.placeholder, app), c = { f: f };
      if (f.type === "custom"){ c.x = f.build(doc, app); c.el = c.x.el; }
      else if (f.type === "pairs"){ c.el = mk("textarea"); c.el.spellcheck = false; }
      else {
        c.el = mk("input");
        c.el.type = f.type === "secret" ? "password" : f.type === "checkbox" ? "checkbox" : f.type === "number" ? "number" : pick(f.input, app) || "text";
        if (f.type === "number"){ if (f.min != null) c.el.min = String(f.min); if (f.step != null) c.el.step = String(f.step); }
        if (f.type !== "checkbox"){ c.el.autocomplete = "off"; c.el.spellcheck = false; }
      }
      if (f.type !== "custom"){ c.el.name = f.name; if (ph) c.el.placeholder = ph; }
      c.ph = ph || "";
      if (app === "phone"){
        if (f.type === "checkbox"){ var l = mk("label", "chk"); l.appendChild(c.el); l.appendChild(doc.createTextNode(" " + label)); if (title) l.title = title; into.appendChild(l); }
        else { var b = mk("b", "lab", label); if (title) b.title = title; into.appendChild(b); into.appendChild(c.el); }
      } else {
        var w = mk("label", f.type === "checkbox" ? "opt" : "field");
        if (title) w.title = title;
        w.appendChild(doc.createTextNode(label + " "));
        w.appendChild(c.el);
        into.appendChild(w);
      }
      ctl[f.name] = c;
    });
    function pairsOf(text){
      var o = {};
      String(text || "").split(/\r?\n/).forEach(function(l){ var m = /^(.+?)\s*=\s*(.+)$/.exec(l.trim()); if (m) o[m[1].trim()] = m[2].trim(); });
      return o;
    }
    return {
      read: function(){
        var v = {};
        Object.keys(ctl).forEach(function(n){
          var c = ctl[n], f = c.f;
          if (f.type === "custom") v[n] = c.x.get();
          else if (f.type === "checkbox") v[n] = !!c.el.checked;
          else if (f.type === "pairs") v[n] = pairsOf(c.el.value);
          else if (f.type === "number"){ var x = Number(c.el.value); v[n] = isFinite(x) && x > 0 ? x : 0; }
          else if (f.type === "secret"){ if (c.el.value.trim()) v[n] = c.el.value.trim(); }
          else v[n] = c.el.value.trim();
        });
        return v;
      },
      // values: the stored settings (Sight: the status — a secret is never in it, `has` says one is saved; the phone:
      // its connection — the secret itself, never put back in the field)
      fill: function(vals){
        vals = vals || {};
        Object.keys(ctl).forEach(function(n){
          var c = ctl[n], f = c.f, v = vals[n];
          if (f.type === "custom") c.x.set(v);
          else if (f.type === "checkbox") c.el.checked = !!v;
          else if (f.type === "pairs") c.el.value = Object.keys(v && typeof v === "object" ? v : {}).map(function(k){ return k + " = " + v[k]; }).join("\n");
          else if (f.type === "number") c.el.value = v ? String(v) : "";
          else if (f.type === "secret"){
            var has = f.has && f.has in vals ? !!vals[f.has] : !!v;
            c.el.value = "";
            c.el.placeholder = has ? "saved (leave empty to keep)" : c.ph;
          }
          else c.el.value = v == null ? "" : String(v);
        });
      },
      focus: function(){ var c = ctl[Object.keys(ctl)[0]]; if (c && c.el.focus){ if (c.el.scrollIntoView) c.el.scrollIntoView({ block: "center" }); c.el.focus(); } },
      input: function(n){ return ctl[n] ? ctl[n].el : null; },
    };
  }

  return { hostOf: hostOf, key: key, split: split, adapter: adapter, adapterOf: adapterOf, kinds: kinds,
    pick: pick, formFields: formFields, secretOf: secretOf, formReady: formReady, secretLost: secretLost, formStored: formStored, mountForm: mountForm };
})();
if (typeof globalThis !== "undefined") globalThis.SightTrackers = SightTrackers;
if (typeof module === "object" && module && module.exports) module.exports = SightTrackers;

# Speech-to-text (dictation) for Sight comment fields

Supersedes the generic draft `docs/tmp/stt-implementation-plan.md` (Russian, written for a native desktop
app; left untouched). Scope: desktop browser UI (note composer, replies, picture texts). The phone app is out
of scope: its keyboard already has dictation.

## 1. What the original plan gets wrong for Sight

- **It assumes a native app.** Sight's UI is a web page in the user's system browser. The microphone belongs
  to the page; Python only serves files. Every engine in the draft would have to run inside the Python
  server, fed with audio streamed from the page (MediaRecorder -> WebSocket / POST), which adds capture,
  codecs, resampling and a streaming protocol for no gain.
- **It misses the free tier that already exists:** the browser's Web Speech API (`SpeechRecognition` /
  `webkitSpeechRecognition`): no key, no install, streaming interim results, any language.
- **Windows SAPI as a fallback is a poor trade.** Russian dictation quality is weak and needs an installed
  language pack; `System.Speech` is .NET-only. macOS `NSSpeechRecognizer` is deprecated, and Safari already
  exposes the on-device engine.
- **Groq as the *main* engine is the wrong default:** it needs the user's API key, sends all audio off the
  machine, and gives no live text (the whole clip is uploaded). Fine as an optional upgrade, not as tier 1.
- **Over-engineered for a text box:** `ISTTProvider`, an `STTRouter` with timeouts / 429 handling, 16 kHz
  capture and Python-side partial results are unnecessary when the first tier is one browser object.
  Fallback is simply "tier unavailable -> next tier or an explanation".

Kept from the original: no bundled ML models, no new heavy dependencies, the strategy idea (one facade,
swappable providers), Groq `whisper-large-v3-turbo` as an optional provider.

## 2. Tiers, in order

| Tier | Engine | Applies when | Cost / privacy |
| --- | --- | --- | --- |
| 1 | Web Speech API (browser) | Chrome, Edge (online, Google service), Safari (on-device / Siri). Not Firefox. | Free, no key. Chrome / Edge send audio to Google. |
| 2 (later, optional) | Groq Whisper via a **backend proxy** | Any browser incl. Firefox; user set a Groq key in Settings; wants better punctuation / noisy audio | User's key; audio leaves the machine to Groq. |
| 3 (maybe never) | Local whisper.cpp / faster-whisper sidecar | Offline use is demanded | Model download (100+ MB), CPU / GPU load; only on explicit request. |
| - | "Unavailable" message | Nothing above works (no API, permission denied, offline) | Never fail silently. |

Selection: `createDictation` picks the first available provider; tier 2 is used only when it is configured and
(a) tier 1 is missing, or (b) the user picked "Whisper" as the engine. No automatic cross-provider fallback in
the middle of a session (it would send audio to a new place without the user noticing).

## 3. JS interface

One facade in `app/static/dictation.js`:

```js
createDictation({ lang, provider, onInterim(text), onFinal(text), onState("starting"|"listening"|"idle"), onError(code) })
  -> { start(), stop() /* delivers pending words */, abort() /* drops them */, state }   // null if unavailable
```

- Providers live in one registry (`PROVIDERS`): `webspeech` now; `groq` later = MediaRecorder chunks ->
  `POST /api/stt/transcribe` -> `onFinal` (no interim; chunk on every pause or every ~5 s). The backend proxy
  holds the key (never in page JS, never in `localStorage`), enforces a size / rate limit, returns text only.
- The facade knows nothing about fields. `createDictationUI` (same file) owns the mic buttons, insertion at the
  caret, the interim bubble, the language popover, Esc / blur / Enter handling. Hosts pass options in
  (`getLang`, `setLang`, `toast`, `floating` selector, `host` element), like the other split-out modules.
- Insertion: `document.execCommand("insertText")` (keeps the field's Ctrl+Z), `setRangeText` + `input` event
  as the fallback. Only final results touch the field; interim text goes to a bubble so the undo stack and the
  saved value never contain provisional words.

## 4. Privacy

- Say it in the manual: Chrome / Edge dictation sends audio to Google's servers; Safari uses Apple's.
  Nothing is recorded or stored by Sight; no audio touches the Sight server in tier 1.
- Microphone permission is the browser's per-origin prompt (`http://127.0.0.1:<port>` is a secure context).
  Denied -> one-line explanation.
- Tier 2 must be opt-in with a visible note ("audio is sent to Groq"), key stored server-side only, never
  logged. Dictated text is ordinary note text (same merge / export rules).

## 5. Done now vs. later

Now (no backend code):
- `dictation.js` with the `webspeech` provider; mic button in the composer; floating mic on reply, note-edit
  and picture-text fields; shortcut Alt+M (help overlay row); language popover (right-click /
  long-press); toasts for unsupported / blocked / offline / no microphone; auto-restart when Chrome ends a
  session on silence.

Later:
- Settings field for an engine choice and the Groq key; `/api/stt/transcribe` proxy; `groq` provider.
- Dictation in other text fields (library search, item notes, tags) via the same `floating` selector.
- Spoken punctuation commands ("new line", "comma") if people ask; a free-form language entry.

Not planned: SAPI / NSSpeechRecognizer, bundled models, a Python `STTRouter`.

## 6. Acceptance criteria (tier 1)

1. A mic button sits in the note composer; reply, note-edit and picture-text fields show one while focused.
   Mouse and touch both work (tap = toggle, long-press = language).
2. While listening the button pulses and an interim bubble shows the provisional words; the field only
   receives final text, joined with a single space, at the caret / over the selection.
3. A second click, Esc or Alt+M stops (pending words still land); blur or Enter / send drops what is in
   flight. Clicking the mic never blurs the field (an edit is not saved / closed by it).
4. Ctrl+Z removes the last dictated phrase.
5. Language: browser language by default; the popover choice persists (`sight.dictation.lang`).
6. No API (Firefox) or denied permission: title + toast explain it; no console errors.
7. The shortcut is a labelled `keyTable()` row and appears in the "?" overlay.
8. Tested with a fake `SpeechRecognition` (interim / final, restart, denied, unsupported); a real-microphone
   pass on Chrome and Safari stays a manual check.

# Plan — Sight as the system quick viewer (later)

Decided with the owner on 2026-11-11. Not started; comes after the mobile plan's early stages
(`docs/PLAN-mobile.md`) unless the owner says otherwise.

## Goal
Sight lives in the tray / menu bar and opens **any file instantly** in a light player with the
review tools (notes, drawing, export for clients). The full Sight window opens only on a separate
command. On macOS it plays the role of Quick Look, on Windows it replaces the QuickLook app.

## Decisions
- **Space on a selected file everywhere** (Windows Explorer and macOS Finder) opens the quick
  viewer. Done later, as its own piece of work.

## Notes for whoever takes it
- Instant open means the server is already running and a player window is kept warm and hidden;
  measure open time (target: picture on screen < 300 ms after the key press).
- Windows: a global keyboard hook that, on Space, reads the selection of the foreground Explorer
  window (Shell.Application windows / IShellWindows → `Document.SelectedItems`), the way the
  QuickLook app does; skip it while a rename edit box or the desktop search has focus.
- macOS: Space in Finder belongs to the system Quick Look. Options: a Quick Look preview extension
  (sandboxed, cannot run Sight's server — limited), or intercepting Space for Finder through an
  event tap (needs Accessibility permission). Decide after a prototype.
- Tray: start with the OS session (optional), menu: Open Sight, Quit; the player and the full
  window share the server and the library.
- File association / "Open with Sight" as a fallback that works without hooks.

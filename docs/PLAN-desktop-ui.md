# Desktop UI backlog (2026-11-24)

Owner's list, sorted from simplest to hardest. Work top-down; each item = one patch version
(`0.122.N`), reviewed by a fresh agent, committed and pushed to `origin/master`.
Mark done items with `[x]` and the version.

## S — small, local fixes
- [x] 1. (0.122.1) Filter type "Missing": hide it when there are no missing files (count 0).
- [x] 2. (0.122.2) Check that the note-count chip on a thumbnail disappears once all notes and drawings are deleted.
- [x] 3. (0.122.1) Smart items that belong to annotations move into a "Reviews" sidebar section (hidden when empty).
- [ ] 4. Bug: a filter saved as a smart collection does not filter, or the current browser filter overrides it.
- [ ] 5. A dropped file hangs too long where it was released while the drop zone under it is checked.
- [ ] 6. Bug: dropping a file in annotation mode also adds it to the compare stack.
- [x] 7. (0.122.3) Lightbox open + Tab: scroll the mini-browser to the current file.
- [x] 8. (0.122.4) Notes panel: resizing the pictures needs a far too long mouse drag (raise the sensitivity).
- [x] 9. (0.122.4) Notes panel gets an interactive (draggable) edge to resize it, like the other panels.

## M — medium, one subsystem
- [ ] 10. Lightbox rotation pivots on the file's centre (after panning), not on the window centre.
- [ ] 11. The stroke marquee works in world coordinates, independent of the file's rotation.
- [ ] 12. Interactive thumbnail size snaps to values where icons fill the window width (no empty strip on the right).
- [ ] 13. HTML export: pictures are not enlarged when drawings go outside the file bounds.
- [ ] 14. Compare mode: markers for frames with drawings are missing on the shared timeline.
- [ ] 15. Notes panel screenshot captures the current drawing as well.
- [ ] 16. Large still images (~6 MB) take up to 5 s to open (macOS Preview: <1 s). Investigate and fix.
- [ ] 17. Arrow: the middle handle can be dragged in any direction to bend arcs of any curvature.

## L — large, cross-cutting
- [ ] 18. Compare mode works for still images.
- [ ] 19. Tab browser = the main browser shrunk by a splitter (not a separate window); search box can get
      narrower, filter / sort labels shorten to 3–4 letters (e.g. Date Modified = DM), then icons only.
- [ ] 20. Interactive scale of the whole UI: one slider in Settings scaling everything proportionally on top
      of the current per-element settings; plus a separate setting for icon-button size.
- [ ] 21. Compare mode and sequence playback merge into the lightbox: they become options of normal viewing
      when more than one file is being viewed.

Rules: desktop + touch for every feature, shortcuts via `keys.js`, RECENT entry + MANUAL where user-visible.

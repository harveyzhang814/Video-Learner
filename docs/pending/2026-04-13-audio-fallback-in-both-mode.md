# ~~TODO: audio fallback when video fails in `both` mode~~

**Resolved** in mode redesign (2026-04-13).

`both` and `video` modes were replaced with `media` (video-first with audio fallback).
In `media` mode, the `audio` step automatically becomes schedulable after `video` fails.
See `docs/superpowers/specs/2026-04-13-mode-redesign.md`.

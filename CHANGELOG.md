# Changelog

## [1.0.13] - 2026-07-27

- Show the complete Albums and Singles/EPs collections directly on artist pages, replacing Jellyfin Web's Albums **More** control.
- Add a bottom-of-page Similar Artists collection from cached ListenBrainz artist-page JSON, with a documented artist-radio API fallback.
- Match recommendations to local Jellyfin artists strictly by MusicBrainz artist ID so local cards retain their already-fetched primary images.
- Do not treat a cache written during a failed Similar Artists lookup as fresh; the next artist navigation retries ListenBrainz instead of hiding matches for the full cache lifetime.
- Match Similar Artists against the current user's complete Jellyfin MusicArtist list, avoiding provider-query omissions for virtual artist entries.
- Replace Jellyfin's native **More Like This** section with a full-width, circular, Movie Cast & Crew-style Similar Artists carousel with working navigation controls.
- Make Top Songs **Show more** and **Show less** compact text controls with down and up chevrons.

## [1.0.2] - 2026-07-26

- Fix Queue-only layout leakage when navigating there from an artist page.
- Render Top Songs on the first cold artist navigation, then position it above Albums when available.
- Keep retrying an already-fetched artist view while Jellyfin Web progressively creates its page sections, and retry a transient empty initial chart with bounded backoff, eliminating intermittent first-load omissions.
- Preserve the complete server-wide Jellyfin chart first, then append only unique, locally playable ListenBrainz matches until the 50-track chart is full.
- Add theme-derived divider lines between compact Top Songs columns.
- Use Jellyfin's supported favourite endpoints and native favourite state classes.
- Restore native MusicAlbum card markup and quick-play overlays for Singles/EPs.
- Fix Single-card square geometry and restore its native title/year footer.
- Keep Singles/EPs as an uninterrupted native card collection, without pagination controls.
- Make hidden controls resilient to custom-theme `[hidden]` overrides.
- Remove the decorative chevron from the Top Songs heading.

All notable changes to Artist Pulse are documented here.

## [1.0.1] - 2026-07-26

### Fixed

- Artist pages now retry their staged DOM render automatically, removing the need for a manual browser refresh.
- Favourite buttons use native Jellyfin classes and theme styling, with a centred native hover target.
- Favourite updates are guarded against double clicks and immediately update the current artist response.

### Changed

- Local Top Songs now aggregate real Jellyfin play counts across all local users for tracks visible to the signed-in user.
- Favourites remain private to the signed-in user.
- **Show less** appears beside **Show more** after the first expansion; it no longer requires expanding the complete list.

## [1.0.0] - 2026-07-26

### Added

- Local-first, user-specific Top Songs for Jellyfin music artist pages.
- Cached, rate-limited ListenBrainz fallback for sparse local history.
- Local-library-only fallback matching: unavailable remote tracks are never displayed.
- Compact 12-track initial view with ranked, top-to-bottom columns and Show more / Show less.
- Whole-row ranked queue playback, native favourite state, item menus, and Jellyfin fallback artwork.
- Separate Albums and Singles / EPs sections using native Jellyfin card styling.
- File Transformation-based Web integration without modifying Jellyfin Web files on disk.

### Notes

- Initial public release of the standalone **Artist Pulse** repository.

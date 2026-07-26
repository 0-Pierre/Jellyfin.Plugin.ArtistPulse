# Changelog

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

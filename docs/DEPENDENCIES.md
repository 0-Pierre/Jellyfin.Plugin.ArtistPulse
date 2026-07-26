# 🔗 Dependencies and compatibility

Artist Pulse is intentionally small. It uses Jellyfin's server APIs and Web client, then delegates Web asset injection to a dedicated plugin rather than modifying installed files.

## Artist Pulse repository

Install Artist Pulse from Jellyfin's repository screen with:

```text
https://raw.githubusercontent.com/0-Pierre/Jellyfin.Plugin.ArtistPulse/main/manifest.json
```

## Required

### Jellyfin Server

- **Supported line:** Jellyfin `10.11.x`
- **Built and tested against:** `10.11.11`
- **Project:** <https://github.com/jellyfin/jellyfin>
- **Releases:** <https://github.com/jellyfin/jellyfin/releases>

Jellyfin plugins are ABI-sensitive. Install an Artist Pulse release that explicitly supports your server version. After a Jellyfin upgrade, update File Transformation and Artist Pulse before reporting a Web UI issue.

### File Transformation

- **Project:** <https://github.com/IAmParadox27/jellyfin-plugin-file-transformation>
- **Repository manifest:** <https://www.iamparadox.dev/jellyfin/plugins/manifest.json>

Artist Pulse registers a non-destructive transformation for Jellyfin Web's served `index.html`. File Transformation injects the plugin stylesheet and script on the server response; Artist Pulse never edits `jellyfin-web` files on disk.

This is a hard dependency for the browser interface. The REST endpoint can still return data without it, but Top Songs and Singles will not appear in Jellyfin Web.

## Optional, recommended metadata

### MusicBrainz

- **Project:** <https://musicbrainz.org/>

The local-first experience does not need MusicBrainz metadata. It is required for the most reliable fallback and release-type detection:

| Item | Provider ID | Used for |
| --- | --- | --- |
| Artist | MusicBrainz artist ID | ListenBrainz artist lookup |
| Track | MusicBrainz recording ID | Match fallback popularity to a local playable track |
| Album | MusicBrainz release-group ID | Distinguish Album, EP, and Single |

### ListenBrainz

- **Service:** <https://listenbrainz.org/>
- **Popularity API documentation:** <https://listenbrainz.readthedocs.io/en/latest/users/api/popularity.html>

When the server-wide local chart contains fewer than 50 tracks, ListenBrainz is used to append unique, locally playable matches after the local ranking. It never replaces or reorders local results. Artist Pulse first requests JSON from the public artist page, then falls back to ListenBrainz's documented Top Recordings by Artist API. No ListenBrainz account, token, or scrobbling configuration is needed.

## Client scope

Artist Pulse renders in **Jellyfin Web**. It deliberately uses native Web classes and the Web playback manager so themes and playback behave consistently. Native mobile, TV, desktop, and third-party clients need their own UI implementation to display these fields.

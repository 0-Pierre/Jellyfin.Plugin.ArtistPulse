# 🔒 Privacy, cache, and network behaviour

## Local data

Artist Pulse aggregates local Jellyfin `PlayCount` values across server users to calculate the server-wide artist chart. It returns only a per-track total for items the signed-in user is allowed to see; it does not return names, individual play histories, or another user's favourite state.

The heart button is personal: Artist Pulse reads and updates favourite state only for the signed-in user. It does not transmit local listening data and does not create a separate listening-history database.

## ListenBrainz fallback

When enabled, the only outbound identifier is the artist's public MusicBrainz artist ID. Artist Pulse uses it for Top Songs when the local chart has fewer than 50 tracks and for Similar Artists on the artist page. It does **not** send:

- Jellyfin users or authentication tokens;
- library names or file paths;
- local track lists;
- personal play counts;
- favourite state.

The fallback's public popularity information is matched back to the server's own library before it reaches the browser. Similar-artist recommendations are returned only when their MusicBrainz artist ID exactly matches a local Jellyfin artist; the browser receives only that local item ID and primary-image ID.

## Cache and throttling

Responses are cached inside Jellyfin's plugin configuration directory. A fresh cache is used for the configured duration (24 hours by default). During an outage, the most recent stale cache remains eligible rather than making the artist page fail.

All ListenBrainz requests—the artist-page JSON POST plus the popularity and similar-artists API fallbacks—share one process-wide request gate. Artist Pulse spaces requests by at least one second and honours `Retry-After` for HTTP 429 responses. Without a server-provided retry period, it pauses new requests for one minute and serves stale cache where possible.

## Control

Disable **Use ListenBrainz for Top Songs and Similar Artists** in Artist Pulse settings to prevent all fallback network requests. Local Jellyfin ranking and Album/Single splitting continue to work.

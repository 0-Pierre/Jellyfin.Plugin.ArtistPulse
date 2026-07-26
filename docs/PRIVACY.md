# 🔒 Privacy, cache, and network behaviour

## Local data

Artist Pulse reads the currently signed-in Jellyfin user's item data only to calculate local ranks and favourite state. It does not transmit this data and does not create a separate listening-history database.

## ListenBrainz fallback

When enabled and local history is sparse, the only outbound identifier is the artist's public MusicBrainz artist ID. Artist Pulse does **not** send:

- Jellyfin users or authentication tokens;
- library names or file paths;
- local track lists;
- personal play counts;
- favourite state.

The fallback's public popularity information is matched back to the server's own library before it reaches the browser.

## Cache and throttling

Responses are cached inside Jellyfin's plugin configuration directory. A fresh cache is used for the configured duration (24 hours by default). During an outage, the most recent stale cache remains eligible rather than making the artist page fail.

All ListenBrainz requests—both the artist-page JSON POST and the API fallback—share one process-wide request gate. Artist Pulse spaces requests by at least one second and honours `Retry-After` for HTTP 429 responses. Without a server-provided retry period, it pauses new requests for one minute.

## Control

Disable **Use ListenBrainz when local history is sparse** in Artist Pulse settings to prevent all fallback network requests. Local Jellyfin ranking and Album/Single splitting continue to work.

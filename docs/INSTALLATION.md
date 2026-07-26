# 🚀 Installation and troubleshooting

## Install from the Artist Pulse repository

1. In Jellyfin Dashboard → **Plugins** → **Repositories**, add the File Transformation repository:

   ```text
   https://www.iamparadox.dev/jellyfin/plugins/manifest.json
   ```

2. Install **File Transformation** and restart Jellyfin.
3. In Dashboard → **Plugins** → **Repositories**, add the Artist Pulse repository:

   ```text
   https://raw.githubusercontent.com/0-Pierre/Jellyfin.Plugin.ArtistPulse/main/manifest.json
   ```

4. Go to Dashboard → **Plugins** → **Catalog**, install **Artist Pulse**, and restart Jellyfin.
5. Run **Artist Pulse Web Integration** from Dashboard → **Scheduled Tasks** if it has not already run at startup.
6. Hard-refresh Jellyfin Web (`Ctrl+F5`) and open a music artist page.

## Install from a release ZIP

1. Download the Artist Pulse ZIP for your Jellyfin version from the [GitHub Releases page](https://github.com/0-Pierre/Jellyfin.Plugin.ArtistPulse/releases).
2. Install it through Dashboard → **Plugins** → manual ZIP installation, or extract it into a new dedicated folder under Jellyfin's plugins directory.
3. Remove the previous Artist Pulse version before starting Jellyfin. Two folders containing the same plugin GUID must not coexist.
4. Restart Jellyfin, run **Artist Pulse Web Integration** if necessary, and hard-refresh Jellyfin Web.

## Docker and manual installs

Mount or copy the release files to Jellyfin's configured plugins directory, preserving the three release files together:

```text
Jellyfin.Plugin.ArtistInsights.dll
Jellyfin.Plugin.ArtistInsights.deps.json
Jellyfin.Plugin.ArtistInsights.pdb
```

Restart the Jellyfin container or service after copying. The `.pdb` is optional at runtime but recommended while diagnosing errors.

## Verify the integration

1. Dashboard → Scheduled Tasks: **Artist Pulse Web Integration** should complete successfully.
2. Browser DevTools → Network: `artist-insights.js` and `artist-insights.css` should load.
3. Browser DevTools → Console:

   ```js
   typeof window.ArtistInsightsHandler
   ```

   should return `"object"` on a Jellyfin Web artist page.
4. The authenticated endpoint is:

   ```text
   /ArtistInsights/artist/{artist-id}
   ```

   It returns `TopSongs`, `Albums`, and `Singles`.

## Troubleshooting

### The startup task fails

Check Jellyfin's server logs first. The most common reason is an incompatible or missing File Transformation installation. Update it for the current Jellyfin release, restart Jellyfin, then rerun the task.

### The script loads but sections do not appear

Hard-refresh the browser. Artist Pulse waits for the native Albums section before inserting its own content. Confirm the endpoint returns data for the current authenticated user.

### A fallback-ranked song is missing

This is by design. Artist Pulse only renders fallback tracks that have a local MusicBrainz recording-ID match and can be played by Jellyfin. Refresh metadata if a local song is not being matched.

### Covers are empty

Artist Pulse uses the album primary image, then the track primary image, then Jellyfin's native album-disc placeholder. Refresh album artwork if a real cover should be available.

### Playback does not start

Confirm that the selected item can play in Jellyfin Web normally. Artist Pulse sends the complete local Top Songs queue through the same Web playback manager used by Jellyfin itself.

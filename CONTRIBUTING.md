# 🤝 Contributing

Thanks for helping improve Artist Pulse.

## Before opening an issue

- Confirm your Jellyfin and File Transformation versions.
- Include browser console errors and the relevant Jellyfin server-log excerpt.
- State whether the ranking source is `jellyfin` or `listenbrainz`.
- Never include access tokens, user IDs, library paths, or private listening history in a public issue.

## Development

1. Install the .NET SDK required by the project and use Jellyfin `10.11.x` development dependencies.
2. Build:

   ```powershell
   dotnet build .\Jellyfin.Plugin.ArtistInsights.sln -c Release
   ```

3. Install File Transformation in a test server.
4. Copy the built DLL and companion files to a dedicated test-plugin folder.
5. Restart Jellyfin and hard-refresh Jellyfin Web.

## Pull requests

- Keep UI markup native and theme-agnostic.
- Do not add hard-coded theme colours unless there is no native Jellyfin equivalent.
- Preserve the guarantee that fallback Top Songs must exist in the local library.
- Keep every outbound ListenBrainz request behind the shared limiter and cache.
- Update `CHANGELOG.md` and user documentation for visible changes.

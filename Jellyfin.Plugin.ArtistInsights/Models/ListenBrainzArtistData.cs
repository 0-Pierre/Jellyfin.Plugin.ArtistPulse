namespace Jellyfin.Plugin.ArtistInsights.Models;

/// <summary>
/// The useful normalized data returned by ListenBrainz's artist-page JSON endpoint.
/// </summary>
public sealed class ListenBrainzArtistData
{
    /// <summary>
    /// Gets or sets the artist's popular recordings.
    /// </summary>
    public IReadOnlyList<ListenBrainzRecording> PopularRecordings { get; init; } = [];

    /// <summary>
    /// Gets or sets MusicBrainz release-group types keyed by release-group MBID.
    /// </summary>
    public IReadOnlyDictionary<string, string> ReleaseGroupTypes { get; init; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
}

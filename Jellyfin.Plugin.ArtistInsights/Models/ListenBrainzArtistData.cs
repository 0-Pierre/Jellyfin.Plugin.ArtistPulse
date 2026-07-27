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

    /// <summary>
    /// Gets or sets ListenBrainz artist-similarity recommendations.
    /// </summary>
    public IReadOnlyList<ListenBrainzSimilarArtist> SimilarArtists { get; init; } = [];

    /// <summary>
    /// Gets or sets a value indicating whether ListenBrainz successfully returned a similarity response.
    /// </summary>
    public bool SimilarArtistsFetched { get; init; }
}

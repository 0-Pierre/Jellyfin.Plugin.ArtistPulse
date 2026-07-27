namespace Jellyfin.Plugin.ArtistInsights.Models;

/// <summary>
/// A normalized ListenBrainz similar-artist recommendation.
/// </summary>
public sealed class ListenBrainzSimilarArtist
{
    /// <summary>
    /// Gets or sets the MusicBrainz artist id.
    /// </summary>
    public required string ArtistMbid { get; init; }

    /// <summary>
    /// Gets or sets the artist name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Gets or sets ListenBrainz's similarity score, when the source returns one.
    /// </summary>
    public long? Score { get; init; }

    /// <summary>
    /// Gets or sets the listen count associated with a radio fallback result.
    /// </summary>
    public long? ListenCount { get; init; }
}

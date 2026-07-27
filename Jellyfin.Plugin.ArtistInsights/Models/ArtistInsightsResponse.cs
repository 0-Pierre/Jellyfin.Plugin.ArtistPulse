namespace Jellyfin.Plugin.ArtistInsights.Models;

/// <summary>
/// Everything Jellyfin Web needs to enhance one artist page.
/// </summary>
public sealed class ArtistInsightsResponse
{
    /// <summary>
    /// Gets or sets the top tracks.
    /// </summary>
    public required IReadOnlyList<TopSongDto> TopSongs { get; init; }

    /// <summary>
    /// Gets or sets the source that ranked <see cref="TopSongs"/>.
    /// </summary>
    public required string TopSongsSource { get; init; }

    /// <summary>
    /// Gets or sets the releases that remain in the Albums section.
    /// </summary>
    public required IReadOnlyList<ReleaseDto> Albums { get; init; }

    /// <summary>
    /// Gets or sets releases shown in the dedicated Singles section.
    /// </summary>
    public required IReadOnlyList<ReleaseDto> Singles { get; init; }

    /// <summary>
    /// Gets or sets ListenBrainz similar-artist recommendations, enriched with matching local artists.
    /// </summary>
    public required IReadOnlyList<SimilarArtistDto> SimilarArtists { get; init; }
}

/// <summary>
/// A ranked song shown in the artist page Top Songs section.
/// </summary>
public sealed class TopSongDto
{
    /// <summary>
    /// Gets or sets the Jellyfin item id, when this recording exists in the local library.
    /// </summary>
    public Guid? ItemId { get; init; }

    /// <summary>
    /// Gets or sets the item that supplies the primary image.
    /// </summary>
    public Guid? ImageItemId { get; init; }

    /// <summary>
    /// Gets or sets the song title.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Gets or sets the release name.
    /// </summary>
    public string? Album { get; init; }

    /// <summary>
    /// Gets or sets the duration in Jellyfin ticks.
    /// </summary>
    public long? RunTimeTicks { get; init; }

    /// <summary>
    /// Gets or sets the local play count or the ListenBrainz global listen count.
    /// </summary>
    public long ListenCount { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether the current user marked the local item as a favourite.
    /// </summary>
    public bool IsFavorite { get; init; }

    /// <summary>
    /// Gets or sets a value indicating whether this result can be played from Jellyfin.
    /// </summary>
    public bool CanPlay { get; init; }
}

/// <summary>
/// A local music release used for client-side Albums/Singles separation.
/// </summary>
public sealed class ReleaseDto
{
    /// <summary>
    /// Gets or sets the Jellyfin album item id.
    /// </summary>
    public Guid Id { get; init; }

    /// <summary>
    /// Gets or sets the local item that supplies a primary image, when one exists.
    /// </summary>
    public Guid? ImageItemId { get; init; }

    /// <summary>
    /// Gets or sets the title of the release.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Gets or sets the release year.
    /// </summary>
    public int? Year { get; init; }

    /// <summary>
    /// Gets or sets the number of tracks in the release.
    /// </summary>
    public int TrackCount { get; init; }
}

/// <summary>
/// A ListenBrainz similar-artist recommendation shown on an artist page.
/// </summary>
public sealed class SimilarArtistDto
{
    /// <summary>
    /// Gets or sets the display name of the matching local Jellyfin artist.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Gets or sets the matching local Jellyfin artist id visible to the current user.
    /// </summary>
    public Guid ItemId { get; init; }

    /// <summary>
    /// Gets or sets the local artist item that supplies a primary image, when available.
    /// </summary>
    public Guid? ImageItemId { get; init; }
}

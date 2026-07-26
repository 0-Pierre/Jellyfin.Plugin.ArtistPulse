namespace Jellyfin.Plugin.ArtistInsights.Models;

/// <summary>
/// A normalized ListenBrainz artist-popularity recording.
/// </summary>
public sealed class ListenBrainzRecording
{
    /// <summary>
    /// Gets or sets the MusicBrainz recording id.
    /// </summary>
    public required string RecordingMbid { get; init; }

    /// <summary>
    /// Gets or sets the recording title.
    /// </summary>
    public required string RecordingName { get; init; }

    /// <summary>
    /// Gets or sets the release title.
    /// </summary>
    public string? ReleaseName { get; init; }

    /// <summary>
    /// Gets or sets the duration in milliseconds.
    /// </summary>
    public long? LengthMilliseconds { get; init; }

    /// <summary>
    /// Gets or sets ListenBrainz's global listen count.
    /// </summary>
    public long ListenCount { get; init; }
}

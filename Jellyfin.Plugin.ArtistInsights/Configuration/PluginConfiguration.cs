using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.ArtistInsights.Configuration;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PluginConfiguration"/> class.
    /// </summary>
    public PluginConfiguration()
    {
        Enabled = true;
        EnableListenBrainzFallback = true;
        MinimumLocalTracks = 3;
        TopSongsLimit = 12;
        ListenBrainzCacheHours = 24;
        SplitSingles = true;
        SingleMaxTrackCount = 3;
        SingleMaxDurationMinutes = 30;
    }

    /// <summary>
    /// Gets or sets a value indicating whether Artist Insights is enabled.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether ListenBrainz is used when local history is sparse.
    /// </summary>
    public bool EnableListenBrainzFallback { get; set; }

    /// <summary>
    /// Gets or sets the number of distinct locally played tracks required to prefer Jellyfin data.
    /// </summary>
    public int MinimumLocalTracks { get; set; }

    /// <summary>
    /// Gets or sets the legacy maximum number of songs in the Top Songs section.
    /// The page initially shows twelve compact rows and reveals more on demand.
    /// Retained only to read configurations written by earlier plugin versions.
    /// </summary>
    public int TopSongsLimit { get; set; }

    /// <summary>
    /// Gets or sets the lifetime, in hours, of cached ListenBrainz responses.
    /// </summary>
    public int ListenBrainzCacheHours { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether Albums are separated from Singles in Jellyfin Web.
    /// </summary>
    public bool SplitSingles { get; set; }

    /// <summary>
    /// Gets or sets the maximum track count used by the local single-release heuristic.
    /// </summary>
    public int SingleMaxTrackCount { get; set; }

    /// <summary>
    /// Gets or sets the maximum total duration, in minutes, used by the local single-release heuristic.
    /// </summary>
    public int SingleMaxDurationMinutes { get; set; }
}

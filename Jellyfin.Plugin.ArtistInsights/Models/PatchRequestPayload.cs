using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.ArtistInsights.Models;

/// <summary>
/// Request payload supplied by the File Transformation plugin.
/// </summary>
public sealed class PatchRequestPayload
{
    /// <summary>
    /// Gets or sets the original file contents.
    /// </summary>
    [JsonPropertyName("contents")]
    public string? Contents { get; set; }
}

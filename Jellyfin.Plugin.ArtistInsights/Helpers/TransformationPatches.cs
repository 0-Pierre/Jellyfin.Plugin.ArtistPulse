using System.Text.RegularExpressions;
using Jellyfin.Plugin.ArtistInsights.Models;

namespace Jellyfin.Plugin.ArtistInsights.Helpers;

/// <summary>
/// File Transformation callbacks that add Artist Insights assets to Jellyfin Web.
/// </summary>
public static class TransformationPatches
{
    /// <summary>
    /// Adds the Artist Insights stylesheet and script before the closing document head.
    /// </summary>
    /// <param name="payload">The contents of Jellyfin Web's index.html.</param>
    /// <returns>The transformed HTML.</returns>
    public static string IndexHtml(PatchRequestPayload payload)
    {
        var contents = payload.Contents ?? string.Empty;
        var plugin = Plugin.Instance;
        if (plugin is null || !plugin.Configuration.Enabled)
        {
            return contents;
        }

        var version = plugin.Version?.ToString() ?? "1";
        var prefix = plugin.WebPathPrefix;
        var injection = $"<link rel=\"stylesheet\" href=\"{prefix}/ArtistInsights/web/artist-insights.css?v={version}\" />" +
                        $"<script type=\"text/javascript\" plugin=\"Jellyfin.Plugin.ArtistInsights\" src=\"{prefix}/ArtistInsights/web/artist-insights.js?v={version}\" defer></script>";
        return Regex.Replace(contents, "</head>", injection + "</head>", RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));
    }
}

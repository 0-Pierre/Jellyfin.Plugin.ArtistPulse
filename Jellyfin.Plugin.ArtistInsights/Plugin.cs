using System;
using System.Collections.Generic;
using System.Globalization;
using Jellyfin.Plugin.ArtistInsights.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Net;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Configuration;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.ArtistInsights;

/// <summary>
/// The main plugin.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    private readonly IServerConfigurationManager _serverConfigurationManager;
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    public Plugin(
        IApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        IServerConfigurationManager serverConfigurationManager)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _serverConfigurationManager = serverConfigurationManager;
    }

    /// <inheritdoc />
    public override string Name => "Artist Pulse";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("bf73dc01-12c1-4d5c-a6a9-1dd8f4cf97c4");

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <summary>
    /// Gets the Jellyfin base URL prefix, including its leading slash when configured.
    /// </summary>
    public string WebPathPrefix
    {
        get
        {
            var baseUrl = _serverConfigurationManager.GetConfiguration<NetworkConfiguration>("network").BaseUrl?.Trim('/');
            return string.IsNullOrEmpty(baseUrl) ? string.Empty : "/" + baseUrl;
        }
    }

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return
        [
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = string.Format(CultureInfo.InvariantCulture, "{0}.Configuration.configPage.html", GetType().Namespace)
            }
        ];
    }
}

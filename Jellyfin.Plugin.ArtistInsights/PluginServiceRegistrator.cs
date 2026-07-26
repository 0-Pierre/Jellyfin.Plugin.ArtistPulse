using Jellyfin.Plugin.ArtistInsights.Services;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.ArtistInsights;

/// <summary>
/// Registers Artist Insights services with Jellyfin's dependency injection container.
/// </summary>
public sealed class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddHttpClient<ListenBrainzClient>();
        serviceCollection.AddSingleton<ArtistInsightsService>();
    }
}

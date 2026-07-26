using System.Reflection;
using Jellyfin.Plugin.ArtistInsights.Models;
using Jellyfin.Plugin.ArtistInsights.Services;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.ArtistInsights.Controllers;

/// <summary>
/// Serves artist page data and client assets for Jellyfin Web.
/// </summary>
[ApiController]
[Authorize]
[Route("ArtistInsights")]
public sealed class ArtistInsightsController : ControllerBase
{
    private readonly ArtistInsightsService _artistInsightsService;
    private readonly IUserManager _userManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArtistInsightsController"/> class.
    /// </summary>
    /// <param name="artistInsightsService">Service that builds an artist response.</param>
    /// <param name="userManager">Jellyfin user manager.</param>
    public ArtistInsightsController(ArtistInsightsService artistInsightsService, IUserManager userManager)
    {
        _artistInsightsService = artistInsightsService;
        _userManager = userManager;
    }

    /// <summary>
    /// Gets server-wide Top Songs and release classification for an artist visible to the authenticated user.
    /// </summary>
    /// <param name="artistId">Jellyfin music artist id.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Artist insights data.</returns>
    [HttpGet("artist/{artistId:guid}")]
    [ProducesResponseType<ArtistInsightsResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ArtistInsightsResponse>> GetArtistInsights(Guid artistId, CancellationToken cancellationToken)
    {
        var claim = User.Claims.FirstOrDefault(static candidate =>
            string.Equals(candidate.Type, "Jellyfin-UserId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!Guid.TryParse(claim, out var userId))
        {
            return Unauthorized();
        }

        var user = _userManager.GetUserById(userId);
        if (user is null)
        {
            return Unauthorized();
        }

        var response = await _artistInsightsService.GetAsync(artistId, user, cancellationToken).ConfigureAwait(false);
        return response is null ? NotFound() : Ok(response);
    }

    /// <summary>
    /// Gets the injected Jellyfin Web script.
    /// </summary>
    /// <returns>JavaScript file.</returns>
    [AllowAnonymous]
    [HttpGet("web/artist-insights.js")]
    [Produces("application/javascript")]
    public ActionResult GetWebScript() => GetEmbeddedResource("Web.artist-insights.js", "application/javascript");

    /// <summary>
    /// Gets the injected Jellyfin Web stylesheet.
    /// </summary>
    /// <returns>Stylesheet file.</returns>
    [AllowAnonymous]
    [HttpGet("web/artist-insights.css")]
    [Produces("text/css")]
    public ActionResult GetWebStyleSheet() => GetEmbeddedResource("Web.artist-insights.css", "text/css");

    private ActionResult GetEmbeddedResource(string resourceSuffix, string contentType)
    {
        var resourceName = typeof(Plugin).Namespace + "." + resourceSuffix;
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
        return stream is null ? NotFound() : File(stream, contentType);
    }
}

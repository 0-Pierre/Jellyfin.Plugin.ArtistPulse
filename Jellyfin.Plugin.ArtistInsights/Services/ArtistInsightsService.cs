using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.ArtistInsights.Configuration;
using Jellyfin.Plugin.ArtistInsights.Models;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.ArtistInsights.Services;

/// <summary>
/// Builds privacy-safe, per-user artist insight responses from the Jellyfin library.
/// </summary>
public sealed class ArtistInsightsService
{
    // The web client initially renders twelve compact rows and reveals the
    // remaining server-ranked rows on demand. Keep the endpoint bounded while
    // allowing Show more to work without another request.
    private const int TopSongsFetchLimit = 50;

    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;
    private readonly ListenBrainzClient _listenBrainzClient;

    /// <summary>
    /// Initializes a new instance of the <see cref="ArtistInsightsService"/> class.
    /// </summary>
    /// <param name="libraryManager">Jellyfin library manager.</param>
    /// <param name="userDataManager">Jellyfin user-data manager.</param>
    /// <param name="listenBrainzClient">ListenBrainz data client.</param>
    public ArtistInsightsService(
        ILibraryManager libraryManager,
        IUserDataManager userDataManager,
        ListenBrainzClient listenBrainzClient)
    {
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
        _listenBrainzClient = listenBrainzClient;
    }

    /// <summary>
    /// Builds the Top Songs, Albums, and Singles data for one artist and the current Jellyfin user.
    /// </summary>
    /// <param name="artistId">Jellyfin music artist id.</param>
    /// <param name="user">Authenticated Jellyfin user.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The artist insights response, or <c>null</c> when the item is not a visible music artist.</returns>
    public async Task<ArtistInsightsResponse?> GetAsync(Guid artistId, User user, CancellationToken cancellationToken)
    {
        var artist = _libraryManager.GetItemById<MusicArtist>(artistId, user);
        if (artist is null)
        {
            return null;
        }

        var configuration = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var tracks = _libraryManager.GetItemList(new InternalItemsQuery(user)
        {
            IncludeItemTypes = [BaseItemKind.Audio],
            ArtistIds = [artist.Id],
            Recursive = true,
            IsFolder = false,
            IsVirtualItem = false,
            EnableTotalRecordCount = false
        }).OfType<Audio>().ToArray();

        var userData = tracks
            .Select(track => new { Track = track, Data = _userDataManager.GetUserData(user, track) })
            .Where(static item => item.Data is not null)
            .ToDictionary(static item => item.Track.Id, static item => item.Data!);
        var localSongs = GetLocalSongs(tracks, userData, TopSongsFetchLimit);
        var topSongsSource = "jellyfin";
        IReadOnlyList<TopSongDto> topSongs = localSongs;

        ListenBrainzArtistData? listenBrainzData = null;
        var artistMbid = artist.GetProviderId(MetadataProvider.MusicBrainzArtist);
        if (configuration.EnableListenBrainzFallback && !string.IsNullOrWhiteSpace(artistMbid))
        {
            listenBrainzData = await _listenBrainzClient.GetArtistDataAsync(
                artistMbid,
                TimeSpan.FromHours(Math.Clamp(configuration.ListenBrainzCacheHours, 1, 720)),
                cancellationToken).ConfigureAwait(false);
            if (localSongs.Count < Math.Max(1, configuration.MinimumLocalTracks))
            {
                var externalSongs = GetListenBrainzSongs(listenBrainzData.PopularRecordings, tracks, userData, TopSongsFetchLimit);
                if (externalSongs.Count > 0)
                {
                    topSongs = externalSongs;
                    topSongsSource = "listenbrainz";
                }
            }
        }

        if (topSongs.Count == 0)
        {
            topSongsSource = "none";
        }

        var releases = GetReleases(tracks, configuration, listenBrainzData?.ReleaseGroupTypes);
        return new ArtistInsightsResponse
        {
            TopSongs = topSongs,
            TopSongsSource = topSongsSource,
            Albums = releases.Albums,
            Singles = releases.Singles
        };
    }

    private static IReadOnlyList<TopSongDto> GetLocalSongs(
        IReadOnlyList<Audio> tracks,
        IReadOnlyDictionary<Guid, UserItemData> userData,
        int limit)
    {
        return tracks
            .Select(track => new
            {
                Track = track,
                Data = userData.GetValueOrDefault(track.Id)
            })
            .Where(static item => item.Data is { PlayCount: > 0 })
            .OrderByDescending(static item => item.Data!.PlayCount)
            .ThenByDescending(static item => item.Data!.LastPlayedDate)
            .ThenBy(static item => item.Track.SortName, StringComparer.OrdinalIgnoreCase)
            .Take(Math.Clamp(limit, 1, 50))
            .Select(static item => ToLocalSong(item.Track, item.Data!))
            .ToArray();
    }

    private static IReadOnlyList<TopSongDto> GetListenBrainzSongs(
        IReadOnlyList<ListenBrainzRecording> recordings,
        IReadOnlyList<Audio> localTracks,
        IReadOnlyDictionary<Guid, UserItemData> userData,
        int limit)
    {
        var localByRecordingMbid = localTracks
            .Select(track => new
            {
                Track = track,
                RecordingMbid = track.GetProviderId(MetadataProvider.MusicBrainzRecording)
            })
            .Where(static item => !string.IsNullOrWhiteSpace(item.RecordingMbid))
            .GroupBy(static item => item.RecordingMbid!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(static group => group.Key, static group => group.First().Track, StringComparer.OrdinalIgnoreCase);

        return recordings
            .Select(recording => new
            {
                Recording = recording,
                LocalTrack = localByRecordingMbid.GetValueOrDefault(recording.RecordingMbid)
            })
            // Never show a remote-only recording: Top Songs is actionable and
            // every displayed row must be playable from this Jellyfin server.
            .Where(static item => item.LocalTrack is not null)
            .Take(Math.Clamp(limit, 1, 50))
            .Select(item => ToListenBrainzSong(item.Recording, item.LocalTrack, userData))
            .ToArray();
    }

    private static TopSongDto ToLocalSong(Audio track, UserItemData userData)
    {
        var album = track.AlbumEntity;
        return new TopSongDto
        {
            ItemId = track.Id,
            ImageItemId = album?.HasImage(ImageType.Primary) == true ? album.Id :
                track.HasImage(ImageType.Primary) ? track.Id : null,
            Name = track.Name,
            Album = track.Album,
            RunTimeTicks = track.RunTimeTicks,
            ListenCount = userData.PlayCount,
            IsFavorite = userData.IsFavorite,
            CanPlay = true
        };
    }

    private static TopSongDto ToListenBrainzSong(
        ListenBrainzRecording recording,
        Audio? localTrack,
        IReadOnlyDictionary<Guid, UserItemData> userData)
    {
        var localData = localTrack is null ? null : userData.GetValueOrDefault(localTrack.Id);
        var album = localTrack?.AlbumEntity;
        return new TopSongDto
        {
            ItemId = localTrack?.Id,
            ImageItemId = album?.HasImage(ImageType.Primary) == true ? album.Id :
                localTrack?.HasImage(ImageType.Primary) == true ? localTrack.Id : null,
            Name = recording.RecordingName,
            Album = recording.ReleaseName,
            RunTimeTicks = localTrack?.RunTimeTicks ?? recording.LengthMilliseconds * TimeSpan.TicksPerMillisecond,
            ListenCount = recording.ListenCount,
            IsFavorite = localData?.IsFavorite ?? false,
            CanPlay = localTrack is not null
        };
    }

    private static (IReadOnlyList<ReleaseDto> Albums, IReadOnlyList<ReleaseDto> Singles) GetReleases(
        IReadOnlyList<Audio> tracks,
        PluginConfiguration configuration,
        IReadOnlyDictionary<string, string>? releaseGroupTypes)
    {
        var releases = tracks
            .Select(track => new { Track = track, Album = track.AlbumEntity })
            .Where(static item => item.Album is not null)
            .GroupBy(static item => item.Album!.Id)
            .Select(group => new
            {
                Album = group.First().Album!,
                Tracks = group.Select(static item => item.Track).ToArray()
            })
            .Select(group => new
            {
                Release = new ReleaseDto
                {
                    Id = group.Album.Id,
                    ImageItemId = group.Album.HasImage(ImageType.Primary) ? group.Album.Id : null,
                    Name = group.Album.Name,
                    Year = group.Album.ProductionYear,
                    TrackCount = group.Tracks.Length
                },
                IsSingle = IsSingle(group.Album, group.Tracks, configuration, releaseGroupTypes)
            })
            .OrderByDescending(static item => item.Release.Year ?? 0)
            .ThenBy(static item => item.Release.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return (
            releases.Where(static item => !item.IsSingle).Select(static item => item.Release).ToArray(),
            configuration.SplitSingles ? releases.Where(static item => item.IsSingle).Select(static item => item.Release).ToArray() : []);
    }

    private static bool IsSingle(
        MusicAlbum album,
        IReadOnlyList<Audio> tracks,
        PluginConfiguration configuration,
        IReadOnlyDictionary<string, string>? releaseGroupTypes)
    {
        var releaseGroupMbid = album.GetProviderId(MetadataProvider.MusicBrainzReleaseGroup);
        if (!string.IsNullOrWhiteSpace(releaseGroupMbid) && releaseGroupTypes?.TryGetValue(releaseGroupMbid, out var releaseType) == true)
        {
            return string.Equals(releaseType, "Single", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(releaseType, "EP", StringComparison.OrdinalIgnoreCase);
        }

        if (album.Tags.Any(tag => string.Equals(tag, "single", StringComparison.OrdinalIgnoreCase) ||
                                  string.Equals(tag, "singles", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        var totalTicks = tracks.Where(static track => track.RunTimeTicks.HasValue).Sum(static track => track.RunTimeTicks!.Value);
        var maximumTicks = TimeSpan.FromMinutes(Math.Clamp(configuration.SingleMaxDurationMinutes, 1, 120)).Ticks;
        return tracks.Count <= Math.Clamp(configuration.SingleMaxTrackCount, 1, 20) && totalTicks <= maximumTicks;
    }
}

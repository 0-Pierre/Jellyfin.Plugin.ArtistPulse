using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.ArtistInsights.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.ArtistInsights.Services;

/// <summary>
/// Retrieves and caches artist popularity data from ListenBrainz.
/// </summary>
public sealed partial class ListenBrainzClient
{
    private const string ApiBaseUrl = "https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/";
    private const string ArtistPageBaseUrl = "https://listenbrainz.org/artist/";
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ArtistLocks = new(StringComparer.OrdinalIgnoreCase);
    private static readonly SemaphoreSlim RemoteRequestGate = new(1, 1);
    private static readonly TimeSpan MinimumRemoteRequestInterval = TimeSpan.FromSeconds(1);
    private static DateTimeOffset _nextRemoteRequestUtc = DateTimeOffset.MinValue;
    private readonly HttpClient _httpClient;
    private readonly string _cacheDirectory;
    private readonly ILogger<ListenBrainzClient> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ListenBrainzClient"/> class.
    /// </summary>
    /// <param name="httpClient">HTTP client used for public ListenBrainz requests.</param>
    /// <param name="applicationPaths">Jellyfin application paths.</param>
    /// <param name="logger">Logger instance.</param>
    public ListenBrainzClient(HttpClient httpClient, IApplicationPaths applicationPaths, ILogger<ListenBrainzClient> logger)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(15);
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("Jellyfin-ArtistPulse/1.0");
        _cacheDirectory = Path.Combine(applicationPaths.PluginConfigurationsPath, "ArtistInsights", "listenbrainz-cache");
        _logger = logger;
    }

    /// <summary>
    /// Gets popular recordings for an artist, using fresh cached data whenever possible.
    /// </summary>
    /// <param name="artistMbid">MusicBrainz artist id.</param>
    /// <param name="cacheDuration">How long a cached response remains fresh.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Normalized artist data, or stale cached data when ListenBrainz is unavailable.</returns>
    public async Task<ListenBrainzArtistData> GetArtistDataAsync(
        string artistMbid,
        TimeSpan cacheDuration,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(artistMbid, out _))
        {
            return new ListenBrainzArtistData();
        }

        var cachePath = GetCachePath(artistMbid);
        var cached = await ReadCacheAsync(cachePath, cancellationToken).ConfigureAwait(false);
        if (cached is not null && DateTimeOffset.UtcNow - cached.FetchedAtUtc < cacheDuration)
        {
            return cached.Data;
        }

        var artistLock = ArtistLocks.GetOrAdd(artistMbid, static _ => new SemaphoreSlim(1, 1));
        await artistLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cached = await ReadCacheAsync(cachePath, cancellationToken).ConfigureAwait(false);
            if (cached is not null && DateTimeOffset.UtcNow - cached.FetchedAtUtc < cacheDuration)
            {
                return cached.Data;
            }

            // The artist-page POST returns popularRecordings and releaseGroups together. It also remains available
            // when the standalone popularity API is temporarily disabled under load.
            var data = await RequestArtistPageJsonAsync(artistMbid, cancellationToken).ConfigureAwait(false);
            if (data.PopularRecordings.Count == 0)
            {
                data = await RequestApiAsync(artistMbid, cancellationToken).ConfigureAwait(false);
            }

            if (data.PopularRecordings.Count > 0)
            {
                await WriteCacheAsync(cachePath, data, cancellationToken).ConfigureAwait(false);
                return data;
            }

            return cached?.Data ?? new ListenBrainzArtistData();
        }
        finally
        {
            artistLock.Release();
        }
    }

    private async Task<ListenBrainzArtistData> RequestApiAsync(string artistMbid, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, ApiBaseUrl + artistMbid);
            using var response = await SendRateLimitedAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogDebug("ListenBrainz popularity API returned {StatusCode} for artist {ArtistMbid}.", response.StatusCode, artistMbid);
                return new ListenBrainzArtistData();
            }

            var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            return new ListenBrainzArtistData { PopularRecordings = ParseRecordingsJson(json) };
        }
        catch (HttpRequestException exception)
        {
            _logger.LogDebug(exception, "ListenBrainz popularity API request failed for artist {ArtistMbid}.", artistMbid);
            return new ListenBrainzArtistData();
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogDebug("ListenBrainz popularity API timed out for artist {ArtistMbid}.", artistMbid);
            return new ListenBrainzArtistData();
        }
    }

    private async Task<ListenBrainzArtistData> RequestArtistPageJsonAsync(string artistMbid, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, ArtistPageBaseUrl + artistMbid + "/");
            request.Headers.Accept.ParseAdd("application/json");
            using var response = await SendRateLimitedAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                return new ListenBrainzArtistData();
            }

            var pageJson = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var pageData = ParseArtistPageJson(pageJson);
            if (pageData.PopularRecordings.Count > 0)
            {
                return pageData;
            }

            // A few historical deployments returned an HTML app shell even for POST. Retain a JSON-script crawl
            // so the fallback remains useful without relying on fragile rendered HTML.
            foreach (Match match in JsonScriptRegex().Matches(pageJson))
            {
                var recordings = ParseRecordingsJson(match.Groups["json"].Value);
                if (recordings.Count > 0)
                {
                    return new ListenBrainzArtistData { PopularRecordings = recordings };
                }
            }
        }
        catch (HttpRequestException exception)
        {
            _logger.LogDebug(exception, "ListenBrainz artist-page JSON crawl failed for artist {ArtistMbid}.", artistMbid);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogDebug("ListenBrainz artist-page JSON crawl timed out for artist {ArtistMbid}.", artistMbid);
        }

        return new ListenBrainzArtistData();
    }

    /// <summary>
    /// Sends every ListenBrainz request through one process-wide, polite limiter.
    /// This covers both the artist-page JSON POST crawl and the API fallback.
    /// </summary>
    private async Task<HttpResponseMessage> SendRateLimitedAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await RemoteRequestGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var now = DateTimeOffset.UtcNow;
            var wait = _nextRemoteRequestUtc - now;
            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, cancellationToken).ConfigureAwait(false);
            }

            var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
            now = DateTimeOffset.UtcNow;
            var cooldown = MinimumRemoteRequestInterval;
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                var retryAfter = response.Headers.RetryAfter?.Delta;
                if (!retryAfter.HasValue && response.Headers.RetryAfter?.Date is { } retryAt)
                {
                    retryAfter = retryAt - now;
                }

                if (retryAfter is { } retryDelay && retryDelay > cooldown)
                {
                    cooldown = retryDelay;
                }
                else if (!retryAfter.HasValue)
                {
                    cooldown = TimeSpan.FromMinutes(1);
                }

                _logger.LogDebug("ListenBrainz rate-limited Artist Pulse; pausing remote requests for {Cooldown}.", cooldown);
            }

            _nextRemoteRequestUtc = now.Add(cooldown);
            return response;
        }
        finally
        {
            RemoteRequestGate.Release();
        }
    }

    private static ListenBrainzArtistData ParseArtistPageJson(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var recordings = document.RootElement.TryGetProperty("popularRecordings", out var popularRecordings)
                ? ParseRecordingArray(popularRecordings)
                : ParseRecordingsJson(json);
            var releaseGroupTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            if (document.RootElement.TryGetProperty("releaseGroups", out var releaseGroups) && releaseGroups.ValueKind == JsonValueKind.Array)
            {
                foreach (var releaseGroup in releaseGroups.EnumerateArray())
                {
                    var mbid = GetString(releaseGroup, "mbid");
                    var type = GetString(releaseGroup, "type");
                    if (!string.IsNullOrWhiteSpace(mbid) && !string.IsNullOrWhiteSpace(type))
                    {
                        releaseGroupTypes[mbid] = type;
                    }
                }
            }

            return new ListenBrainzArtistData
            {
                PopularRecordings = recordings,
                ReleaseGroupTypes = releaseGroupTypes
            };
        }
        catch (JsonException)
        {
            return new ListenBrainzArtistData();
        }
    }

    private static IReadOnlyList<ListenBrainzRecording> ParseRecordingsJson(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var recordingArray = FindRecordingArray(document.RootElement);
            if (recordingArray is null)
            {
                return [];
            }

            return ParseRecordingArray(recordingArray.Value);
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static IReadOnlyList<ListenBrainzRecording> ParseRecordingArray(JsonElement recordingArray)
        => recordingArray
            .EnumerateArray()
            .Select(ToRecording)
            .Where(static recording => recording is not null)
            .Cast<ListenBrainzRecording>()
            .OrderByDescending(static recording => recording.ListenCount)
            .ToArray();

    private static JsonElement? FindRecordingArray(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array && IsRecordingArray(element))
        {
            return element;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Array &&
                (string.Equals(property.Name, "recordings", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(property.Name, "top_recordings", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(property.Name, "popularRecordings", StringComparison.OrdinalIgnoreCase)) &&
                IsRecordingArray(property.Value))
            {
                return property.Value;
            }

            var nested = FindRecordingArray(property.Value);
            if (nested is not null)
            {
                return nested;
            }
        }

        return null;
    }

    private static bool IsRecordingArray(JsonElement element)
    {
        foreach (var item in element.EnumerateArray())
        {
            return item.ValueKind == JsonValueKind.Object &&
                   (item.TryGetProperty("recording_mbid", out _) || item.TryGetProperty("recording_name", out _));
        }

        return false;
    }

    private static ListenBrainzRecording? ToRecording(JsonElement element)
    {
        if (!TryGetString(element, "recording_mbid", out var recordingMbid) || string.IsNullOrWhiteSpace(recordingMbid))
        {
            return null;
        }

        return new ListenBrainzRecording
        {
            RecordingMbid = recordingMbid,
            RecordingName = GetString(element, "recording_name") ?? "Unknown recording",
            ReleaseName = GetString(element, "release_name"),
            LengthMilliseconds = GetInt64(element, "length"),
            ListenCount = GetInt64(element, "total_listen_count") ?? GetInt64(element, "listen_count") ?? 0
        };
    }

    private static bool TryGetString(JsonElement element, string name, out string? value)
    {
        value = GetString(element, name);
        return value is not null;
    }

    private static string? GetString(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static long? GetInt64(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number) ? number : null;
    }

    private string GetCachePath(string artistMbid) => Path.Combine(_cacheDirectory, artistMbid.ToLowerInvariant() + ".json");

    private async Task<CacheEntry?> ReadCacheAsync(string cachePath, CancellationToken cancellationToken)
    {
        try
        {
            if (!File.Exists(cachePath))
            {
                return null;
            }

            await using var stream = File.OpenRead(cachePath);
            return await JsonSerializer.DeserializeAsync<CacheEntry>(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        catch (IOException exception)
        {
            _logger.LogDebug(exception, "Unable to read the ListenBrainz cache file {CachePath}.", cachePath);
            return null;
        }
        catch (JsonException exception)
        {
            _logger.LogDebug(exception, "Ignoring invalid ListenBrainz cache file {CachePath}.", cachePath);
            return null;
        }
    }

    private async Task WriteCacheAsync(string cachePath, ListenBrainzArtistData data, CancellationToken cancellationToken)
    {
        try
        {
            Directory.CreateDirectory(_cacheDirectory);
            var temporaryPath = cachePath + ".tmp";
            await using (var stream = File.Create(temporaryPath))
            {
                await JsonSerializer.SerializeAsync(stream, new CacheEntry
                {
                    FetchedAtUtc = DateTimeOffset.UtcNow,
                    Data = data
                }, cancellationToken: cancellationToken).ConfigureAwait(false);
            }

            File.Move(temporaryPath, cachePath, true);
        }
        catch (IOException exception)
        {
            _logger.LogDebug(exception, "Unable to write the ListenBrainz cache file {CachePath}.", cachePath);
        }
    }

    [GeneratedRegex("<script[^>]*type=[\"']application/json[\"'][^>]*>(?<json>.*?)</script>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex JsonScriptRegex();

    private sealed class CacheEntry
    {
        public DateTimeOffset FetchedAtUtc { get; init; }

        public ListenBrainzArtistData Data { get; init; } = new();
    }
}

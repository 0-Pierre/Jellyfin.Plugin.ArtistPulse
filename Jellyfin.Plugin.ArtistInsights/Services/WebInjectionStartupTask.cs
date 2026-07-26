using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Jellyfin.Plugin.ArtistInsights.Helpers;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.ArtistInsights.Services;

/// <summary>
/// Registers the non-destructive Jellyfin Web injection with File Transformation after server startup.
/// </summary>
public sealed class WebInjectionStartupTask : IScheduledTask
{
    private readonly ILogger<WebInjectionStartupTask> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="WebInjectionStartupTask"/> class.
    /// </summary>
    /// <param name="logger">Logger instance.</param>
    public WebInjectionStartupTask(ILogger<WebInjectionStartupTask> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public string Name => "Artist Pulse Web Integration";

    /// <inheritdoc />
    public string Key => "Jellyfin.Plugin.ArtistInsights.WebInjection";

    /// <inheritdoc />
    public string Description => "Registers Artist Pulse with the File Transformation plugin.";

    /// <inheritdoc />
    public string Category => "Artist Pulse";

    /// <inheritdoc />
    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        var fileTransformationAssembly = AssemblyLoadContext.All
            .SelectMany(static context => context.Assemblies)
            .FirstOrDefault(static assembly => assembly.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);
        var registrationType = fileTransformationAssembly?.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
        var registerMethod = registrationType?.GetMethod("RegisterTransformation");

        if (registerMethod is null)
        {
            _logger.LogWarning("File Transformation was not found. Artist Pulse data is available, but Jellyfin Web cannot display it until File Transformation is installed and Jellyfin is restarted.");
            return Task.CompletedTask;
        }

        var payloadJson = JsonSerializer.Serialize(new Dictionary<string, string?>
        {
            ["id"] = "a816082a-ee52-479f-87cc-9ac4100c6b65",
            ["fileNamePattern"] = "index.html",
            ["callbackAssembly"] = GetType().Assembly.FullName,
            ["callbackClass"] = typeof(TransformationPatches).FullName,
            ["callbackMethod"] = nameof(TransformationPatches.IndexHtml)
        });

        // Plugins load in separate AssemblyLoadContexts. Creating a Newtonsoft JObject in this plugin would make
        // it incompatible with File Transformation's JObject, even with the same assembly-qualified type name.
        // Create the argument through File Transformation's reflected parameter type instead.
        var payloadType = registerMethod.GetParameters()[0].ParameterType;
        var parseMethod = payloadType.GetMethod("Parse", new[] { typeof(string) });
        if (parseMethod is null)
        {
            _logger.LogError("File Transformation's registration payload type does not expose JObject.Parse(string).");
            return Task.CompletedTask;
        }

        var payload = parseMethod.Invoke(null, new object?[] { payloadJson });
        if (payload is null)
        {
            _logger.LogError("Unable to create a File Transformation registration payload.");
            return Task.CompletedTask;
        }

        registerMethod.Invoke(null, new object?[] { payload });
        _logger.LogInformation("Registered Artist Pulse Jellyfin Web injection.");
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
        => [new TaskTriggerInfo { Type = TaskTriggerInfoType.StartupTrigger }];
}

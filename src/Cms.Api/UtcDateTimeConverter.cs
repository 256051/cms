using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Cms.Api;

/// <summary>Database timestamps are stored as UTC even when the provider returns an unspecified Kind.</summary>
public sealed class UtcDateTimeConverter : JsonConverter<DateTime>
{
    /// <summary>Read an ISO timestamp into UTC.</summary>
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => DateTime.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
    /// <summary>Always emit an explicit UTC offset.</summary>
    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) => writer.WriteStringValue(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}

using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Cms.Data;

namespace Cms.Services;

/// <summary>A bounded additional inquiry field; types are native controls and cannot contain executable content.</summary>
public record InquiryField(string Key, string Label, string Type = "text", bool Required = false, string[]? Options = null);
/// <summary>Versioned public form definition.</summary>
public record InquiryFormView(InquiryField[] Fields, int Version = 0);

/// <summary>Validation shared by editorial business fields and configurable inquiry forms.</summary>
public static class BusinessFields
{
    /// <summary>Reject oversized, duplicate or malformed business attributes before saving.</summary>
    public static ContentField[] Validate(ContentField[]? fields)
    {
        fields ??= [];
        if (fields.Length > 20 || fields.Any(x => x == null || !Key(x.Key) || !Plain(x.Label, 60) || x.Label.Trim() == "" || !Plain(x.Value, 2000)) ||
            fields.Select(x => x.Key).Distinct().Count() != fields.Length) throw Bad();
        return fields.Select(x => x with { Label = x.Label.Trim(), Value = x.Value.Trim() }).ToArray();
    }

    internal static bool Key(string? value) => value != null && Regex.IsMatch(value, "^[a-z][a-z0-9-]{0,31}$");
    internal static bool Plain(string? value, int max) => value != null && value.Length <= max &&
        !value.Any(c => c is '<' or '>' || char.IsControl(c) && c is not ('\r' or '\n' or '\t'));
    internal static CmsException Bad() => new(400, "INVALID_FIELDS", "请检查字段名称、类型和填写内容；最多 20 个字段，名称不超过 60 字，内容不超过 2000 字。");
}

public sealed partial class TrafficService
{
    private static readonly InquiryField[] DefaultInquiryFields = [new("product", "意向产品"), new("budget", "预算范围"), new("appointment", "预约日期", "date")];

    /// <summary>Read current public-safe form configuration.</summary>
    public async Task<InquiryFormView> InquiryFormAsync()
    {
        var row = await repository.FindAsync<InquiryFormSettings>("site");
        return row == null ? new(DefaultInquiryFields) : new(JsonSerializer.Deserialize<InquiryField[]>(row.FieldsJson)!, row.Version);
    }

    /// <summary>Save additional inquiry fields without changing fixed contact or consent validation.</summary>
    public Task<InquiryFormView> SaveInquiryFormAsync(string actor, InquiryFormView input) => repository.WriteAsync(actor, "inquiry-form.save", async repo =>
    {
        if (input.Fields is not { Length: <= 20 } || input.Fields.Any(x => x == null || !BusinessFields.Key(x.Key) ||
            !BusinessFields.Plain(x.Label, 60) || x.Label.Trim() == "" || x.Type is not ("text" or "textarea" or "number" or "date" or "select") ||
            x.Options is { Length: > 20 } || x.Options?.Any(o => !BusinessFields.Plain(o, 80) || o.Trim() == "") == true ||
            x.Type == "select" && x.Options is not { Length: > 0 } || x.Options?.Distinct().Count() != x.Options?.Length) ||
            input.Fields.Select(x => x.Key).Distinct().Count() != input.Fields.Length) throw BusinessFields.Bad();
        var fields = input.Fields.Select(x => x with { Label = x.Label.Trim(), Options = x.Type == "select" ? x.Options : [] }).ToArray();
        var row = await repo.FindAsync<InquiryFormSettings>("site");
        if (input.Version != (row?.Version ?? 0)) throw Conflict();
        var fresh = row == null; row ??= new() { Id = "site" };
        row.Version++; row.FieldsJson = JsonSerializer.Serialize(fields);
        repo.SetAuditTarget("inquiry-form", "site", "客户咨询表单");
        if (fresh) await repo.InsertAsync(row); else await repo.UpdateAsync(row);
        return new InquiryFormView(fields, row.Version);
    });

    private static async Task<ContentField[]> ValidateInquiryValuesAsync(CmsRepository repo, Dictionary<string, string>? values)
    {
        values ??= [];
        if (values.Count > 20 || values.Any(x => !BusinessFields.Key(x.Key) || !BusinessFields.Plain(x.Value, 2000))) throw BusinessFields.Bad();
        var row = await repo.FindAsync<InquiryFormSettings>("site");
        var fields = row == null ? DefaultInquiryFields : JsonSerializer.Deserialize<InquiryField[]>(row.FieldsJson)!;
        if (values.Keys.Except(fields.Select(x => x.Key)).Any()) throw new CmsException(409, "FORM_CHANGED", "咨询表单已更新，请刷新页面后重新填写新增字段。");
        var result = new List<ContentField>();
        foreach (var field in fields)
        {
            var value = values.GetValueOrDefault(field.Key, "").Trim();
            if (field.Required && value == "") throw new CmsException(400, "REQUIRED_FIELD", $"请填写“{field.Label}”。");
            if (value != "" && (field.Type == "select" && !field.Options!.Contains(value) ||
                field.Type == "date" && !DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) ||
                field.Type == "number" && (!decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number) || number is < -1_000_000_000 or > 1_000_000_000)))
                throw new CmsException(400, "INVALID_FIELD_VALUE", $"“{field.Label}”的填写格式无效。");
            if (value != "") result.Add(new(field.Key, field.Label, value));
        }
        return result.ToArray();
    }

    private static bool SameInquiryValues(string json, Dictionary<string, string>? values)
    {
        var supplied = (values ?? []).Where(x => !string.IsNullOrWhiteSpace(x.Value)).ToDictionary(x => x.Key, x => x.Value.Trim());
        var saved = JsonSerializer.Deserialize<ContentField[]>(json == "" ? "[]" : json) ?? [];
        return saved.Length == supplied.Count && saved.All(x => supplied.GetValueOrDefault(x.Key) == x.Value);
    }
}

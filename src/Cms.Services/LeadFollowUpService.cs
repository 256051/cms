using System.Text;
using System.Text.Json;
using Cms.Data;

namespace Cms.Services;

public sealed partial class TrafficService
{
    /// <summary>Read immutable inquiry follow-up history.</summary>
    public async Task<PageResult<LeadFollowUp>> FollowUpsAsync(string id, int page)
    {
        Id(id);
        _ = await repository.FindAsync<CustomerLead>(id) ?? throw Missing();
        return await repository.PageAsync<LeadFollowUp>(x => x.LeadId == id, page, 20);
    }

    /// <summary>Count actionable contacts whose planned time has elapsed.</summary>
    public Task<long> OverdueLeadsAsync() => repository.CountAsync<CustomerLead>(x =>
        x.NextContactAt < DateTime.UtcNow && x.Status != "completed" && x.Status != "invalid");

    /// <summary>Export filtered private inquiries as UTF-8 CSV with spreadsheet formulas neutralized.</summary>
    public async Task<byte[]> ExportLeadsAsync(string status, string query, string owner, bool overdue)
    {
        Status(status, true); Text(query, 200);
        if (owner != "") Id(owner);
        var now = DateTime.UtcNow;
        var rows = await repository.ListAsync<CustomerLead>(x => (status == "" || x.Status == status) &&
            (query == "" || x.Name.Contains(query) || x.Contact.Contains(query) || x.Organization.Contains(query)) &&
            (owner == "" || x.OwnerId == owner) && (!overdue || (x.NextContactAt < now && x.Status != "completed" && x.Status != "invalid")));
        var users = (await repository.ListAsync<CmsUser>()).ToDictionary(x => x.Id, x => x.DisplayName);
        static string Cell(string value)
        {
            if (value.TrimStart().FirstOrDefault() is '=' or '+' or '-' or '@' or '\t' or '\r') value = "'" + value;
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        }
        var custom = rows.ToDictionary(x => x.Id, x => JsonSerializer.Deserialize<ContentField[]>(x.FieldsJson == "" ? "[]" : x.FieldsJson) ?? []);
        var columns = custom.Values.SelectMany(x => x).Select(x => (x.Key, x.Label)).Distinct().ToArray();
        var csv = new StringBuilder("\uFEFF姓名,联系方式,单位,需求,来源,状态,负责人,下次联系时间(UTC),备注,创建时间(UTC)");
        foreach (var column in columns) csv.Append(',').Append(Cell(column.Label + " [" + column.Key + "]"));
        csv.Append("\r\n");
        foreach (var row in rows)
            csv.AppendLine(string.Join(',', new[] { row.Name, row.Contact, row.Organization, row.Need, row.Source,
                row.Status, users.GetValueOrDefault(row.OwnerId, ""), row.NextContactAt?.ToString("O") ?? "", row.Notes, row.CreatedAt.ToString("O") }
                .Concat(columns.Select(column => custom[row.Id].FirstOrDefault(x => x.Key == column.Key && x.Label == column.Label)?.Value ?? "")).Select(Cell)));
        return Encoding.UTF8.GetBytes(csv.ToString());
    }
}

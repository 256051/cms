using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>Administrator-managed additional inquiry fields; core contact and consent fields remain mandatory.</summary>
[Table(Name = "cms_inquiry_form")]
public class InquiryFormSettings : Entity
{
    /// <summary>Validated public field definitions, excluding submitted customer values.</summary>
    [Column(StringLength = -2)] public string FieldsJson { get; set; } = "[]";
    /// <summary>Optimistic configuration revision.</summary>
    public int Version { get; set; }
}

using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>Encrypted site-wide writing assistant configuration.</summary>
[Table(Name = "cms_ai_settings")]
public class AiSettings : Entity
{
    /// <summary>Data Protection ciphertext containing the provider configuration.</summary>
    [Column(StringLength = -2)] public string ProtectedJson { get; set; } = "";
    /// <summary>Optimistic configuration revision.</summary>
    public int Version { get; set; }
}

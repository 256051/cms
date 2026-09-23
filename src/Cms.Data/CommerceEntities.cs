using FreeSql.DataAnnotations;

namespace Cms.Data;

/// <summary>Sale terms for an existing product; its ID is the content ID.</summary>
[Table(Name = "cms_shop_products")]
public class ShopProduct : Entity
{
    /// <summary>Whether new purchases are allowed.</summary>
    public bool Enabled { get; set; }
    /// <summary>Price in the currency's smallest unit, never floating point.</summary>
    public long Price { get; set; }
    /// <summary>Supported two-decimal ISO currency.</summary>
    [Column(StringLength = 3)] public string Currency { get; set; } = "CNY";
    /// <summary>Private deliverable, independent of public editorial attachments.</summary>
    [Column(StringLength = 32)] public string FileId { get; set; } = "";
    /// <summary>Optimistic editing revision.</summary>
    public int Version { get; set; }
}

/// <summary>Immutable private download metadata; past orders retain their original file.</summary>
[Table(Name = "cms_shop_files")]
public class ShopFile : Entity
{
    /// <summary>Original safe download name.</summary>
    [Column(StringLength = 200)] public string Name { get; set; } = "";
    /// <summary>Verified byte length.</summary>
    public long Size { get; set; }
    /// <summary>Integrity checksum.</summary>
    [Column(StringLength = 64)] public string Sha256 { get; set; } = "";
}

/// <summary>Encrypted channel credentials and versioned checkout configuration.</summary>
[Table(Name = "cms_shop_settings")]
public class ShopSettings : Entity
{
    /// <summary>Data Protection ciphertext; includes the site's approved payment return origin.</summary>
    [Column(StringLength = -2)] public string ProtectedJson { get; set; } = "";
    /// <summary>Optimistic configuration revision.</summary>
    public int Version { get; set; }
}

/// <summary>Single-item digital order with immutable price and delivery snapshots.</summary>
[Table(Name = "cms_shop_orders")]
[Index("ux_shop_order_token", nameof(TokenHash), true)]
[Index("ux_shop_transaction", nameof(PaymentIdentity), true)]
public class ShopOrder : Entity
{
    /// <summary>Original product identity.</summary>
    [Column(StringLength = 32)] public string ProductId { get; set; } = "";
    /// <summary>Purchased public title.</summary>
    [Column(StringLength = 200)] public string Title { get; set; } = "";
    /// <summary>Frozen private file identity.</summary>
    [Column(StringLength = 32)] public string FileId { get; set; } = "";
    /// <summary>Minor-unit amount calculated on the server.</summary>
    public long Amount { get; set; }
    /// <summary>Frozen settlement currency.</summary>
    [Column(StringLength = 3)] public string Currency { get; set; } = "CNY";
    /// <summary>alipay, wechat or stripe.</summary>
    [Column(StringLength = 16)] public string Channel { get; set; } = "";
    /// <summary>pending, paid, closed or refunded.</summary>
    [Column(StringLength = 16)] public string Status { get; set; } = "pending";
    /// <summary>Hash of the browser-generated 256-bit receipt secret; never returned.</summary>
    [Column(StringLength = 64)] public string TokenHash { get; set; } = "";
    /// <summary>Buyer contact for order support.</summary>
    [Column(StringLength = 254)] public string Email { get; set; } = "";
    /// <summary>True for test/sandbox payments, which never unlock production files.</summary>
    public bool TestMode { get; set; }
    /// <summary>Account fingerprint prevents routing an old order to a different merchant.</summary>
    [Column(StringLength = 64)] public string AccountHash { get; set; } = "";
    /// <summary>Checkout session or provider transaction reference.</summary>
    [Column(StringLength = 200)] public string ProviderReference { get; set; } = "";
    /// <summary>Verified unique provider transaction; unpaid orders use a distinct local placeholder.</summary>
    [Column(StringLength = 220)] public string PaymentIdentity { get; set; } = "";
    /// <summary>Hosted checkout URL or signed native payment code, never a fulfillment credential.</summary>
    [Column(StringLength = -2)] public string PaymentUrl { get; set; } = "";
    /// <summary>Provider-confirmed payment time.</summary>
    public DateTime? PaidAt { get; set; }
    /// <summary>Time after which no new payment attempt is created.</summary>
    public DateTime ExpiresAt { get; set; }
}

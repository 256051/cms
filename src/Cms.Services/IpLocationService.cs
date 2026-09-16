using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using IP2Region.Net.Abstractions;
using IP2Region.Net.XDB;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Cms.Services;

/// <summary>Resolve approximate regions locally without sending visitor addresses to another service.</summary>
public sealed class IpLocationService : IDisposable
{
    private static readonly IPNetwork[] PrivateNetworks =
        [IPNetwork.Parse("10.0.0.0/8"), IPNetwork.Parse("100.64.0.0/10"), IPNetwork.Parse("169.254.0.0/16"),
         IPNetwork.Parse("172.16.0.0/12"), IPNetwork.Parse("192.168.0.0/16"), IPNetwork.Parse("fc00::/7")];
    private static readonly IPNetwork[] ReservedNetworks =
        [IPNetwork.Parse("0.0.0.0/8"), IPNetwork.Parse("192.0.0.0/24"), IPNetwork.Parse("192.0.2.0/24"),
         IPNetwork.Parse("198.18.0.0/15"), IPNetwork.Parse("198.51.100.0/24"), IPNetwork.Parse("203.0.113.0/24"),
         IPNetwork.Parse("224.0.0.0/3"), IPNetwork.Parse("2001:db8::/32"), IPNetwork.Parse("ff00::/8")];
    private readonly ISearcher? ipv4;
    private readonly ISearcher? ipv6;
    private readonly ILogger<IpLocationService> logger;
    private int lookupWarning;

    /// <summary>Load one immutable database per address family; deployment paths also support Consul.</summary>
    public IpLocationService(IConfiguration configuration, ILogger<IpLocationService> logger)
    {
        this.logger = logger;
        var directory = Path.GetFullPath(configuration["GeoIp:Directory"] ?? "GeoData", AppContext.BaseDirectory);
        ipv4 = Load(Path.Combine(directory, "ip2region_v4.xdb"), 4);
        ipv6 = Load(Path.Combine(directory, "ip2region_v6.xdb"), 6);
    }

    /// <summary>Normalize the server-observed IP and resolve country, province and city where available.</summary>
    public (string IpAddress, string Location) Resolve(IPAddress? address)
    {
        if (address == null) return ("", "未知地区");
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily == AddressFamily.InterNetworkV6 && address.ScopeId != 0)
            address = new IPAddress(address.GetAddressBytes());
        var ip = address.ToString();
        if (IPAddress.IsLoopback(address)) return (ip, "本机地址");
        if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || PrivateNetworks.Any(x => x.Contains(address)))
            return (ip, "内网地址");
        if (address.Equals(IPAddress.IPv6Any) || ReservedNetworks.Any(x => x.Contains(address)))
            return (ip, "保留地址");
        try
        {
            var searcher = address.AddressFamily == AddressFamily.InterNetwork ? ipv4 : ipv6;
            // The bundled v3 data format is country|province|city|ISP|country-code.
            var parts = (searcher?.Search(address) ?? "").Split('|').Take(3)
                .Select(x => x.Trim()).Where(x => x is not ("" or "0")).Distinct();
            var location = string.Join(" · ", parts);
            return (ip, location.Length is > 0 and <= 200 ? location : "未知地区");
        }
        catch (Exception error) when (error is IOException or ArgumentException or InvalidOperationException or OverflowException)
        {
            if (Interlocked.Exchange(ref lookupWarning, 1) == 0)
                logger.LogWarning("离线 IP 地址库查询失败，地区暂记为未知；请检查 GeoIp:Directory 后重启。");
            return (ip, "未知地区");
        }
    }

    private ISearcher? Load(string path, int version)
    {
        try
        {
            // The SDK assumes the file family and layout match; reject mismatched or truncated headers first.
            using var file = File.OpenRead(path);
            Span<byte> header = stackalloc byte[20];
            file.ReadExactly(header);
            var segmentSize = version == 4 ? 14 : 38;
            var start = BinaryPrimitives.ReadUInt32LittleEndian(header[8..]);
            var end = BinaryPrimitives.ReadUInt32LittleEndian(header[12..]);
            if (BinaryPrimitives.ReadUInt16LittleEndian(header) != 3 ||
                BinaryPrimitives.ReadUInt16LittleEndian(header[2..]) != 1 ||
                BinaryPrimitives.ReadUInt16LittleEndian(header[16..]) != version ||
                BinaryPrimitives.ReadUInt16LittleEndian(header[18..]) != 4 ||
                start < 256 + 256 * 256 * 8 || end < start ||
                (long)end + segmentSize > file.Length || (end - start) % segmentSize != 0)
                throw new InvalidDataException("Incompatible xdb v3 header.");
            return new Searcher(CachePolicy.Content, path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            logger.LogWarning("IPv{Version} 离线地址库不可用，地区暂记为未知；请检查 {Path} 后重启。", version, path);
            return null;
        }
    }

    /// <summary>Release the offline readers when the application stops.</summary>
    public void Dispose()
    {
        ipv4?.Dispose();
        ipv6?.Dispose();
    }
}

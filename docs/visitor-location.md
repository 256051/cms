# 访客 IP 与所属地区

后台 **访客记录** 的“最近 IP / 所属地区”显示最新一次被接受的访问；“查看轨迹”中的“访问 IP / 所属地区”显示该次访问的信息。两处仅管理员可读，不在公开访问回执或内容接口返回。

同一浏览器换网络仍为同一个 UV。旧访问不随最近 IP 或地址库更新而改变；同一请求编号重试不增加 PV，也不改写访客的最近网络。地区为地址库推断的国家、省、市，可能只有部分信息，并非实时定位；代理或 VPN 地址可能属于出口所在地。本机、内网、保留地址分别标注，查不到的公网 IP 显示“未知地区”。历史未采集字段显示“未记录”。

## 地址来源与离线库

- 仅接收 ASP.NET Core 通过已有可信代理配置处理后的连接地址。请求正文中的 IP / 地区、任意 `X-Real-IP` 均不作为来源；不要扩大 `ForwardedHeaders:KnownNetworks` 到不受控网络。
- 使用 IP2Region.Net 3.0.2 和内置 IPv4 / IPv6 xdb v3 库，默认随构建、发布及 Docker API 镜像复制，无需注册服务或填写密钥，也不会上传访客 IP。
- `GeoIp:Directory` 默认 `GeoData`，相对路径从程序发布目录解析。需要替换数据时可在 Consul JSON 中设置 `GeoIp.Directory`，或设置环境变量 `GeoIp__Directory`；环境变量优先，修改后重启。
- 自定义目录必须包含 `ip2region_v4.xdb`、`ip2region_v6.xdb`，格式为 v3、4 字节指针、`国家|省份|城市|ISP|国家代码`。可将目录只读挂载到容器并配置绝对路径。来源、哈希和许可见 [GeoData](../src/Cms.Services/GeoData/README.md)。
- 地址库在进程中复用，合计约 46 MiB 数据缓存；不在访问请求中下载数据。缺失、头信息不兼容或查询失败时记为未知地区，仍保存 IP 和有效访问，并记录不包含访客 IP 的服务警告。
- 继续尊重浏览器“请勿跟踪”，排除工作人员、预览和已识别爬虫。前台说明已告知记录 IP 与大致地区。IP 随访问数据进入备份，沿用当前访问明细保留规则。

## 升级

IP 与地区字段从 **schema 8** 引入：7 → 8 在 `cms_visitors` 和 `cms_page_visits` 各增加 `IpAddress`（45 字符）、`Location`（200 字符），旧数据留空。schema 9 新增保留期限及 [内容运营功能](editorial-enhancements.md)，当前 **schema 10** 进一步支持 [页面搭建与模板](page-builder.md)。API 启动时自动升级；部署前停止旧实例并备份数据库、附件、密钥及配置。

## 验证入口

```powershell
dotnet build Cms.slnx -c Release --no-restore
dotnet tests/Cms.Checks/bin/Release/net10.0/Cms.Checks.dll --geolocation
python tests/geolocation_acceptance.py all
python tests/traffic_acceptance.py all
python tests/startup_upgrade.py
npm --prefix web run api:types
npm --prefix web run typecheck
npm --prefix web run build
python tests/geolocation_browser.py
```

这些脚本创建隔离数据库，不连接日常站点；覆盖真实地址库、IPv4/IPv6、私网、可信代理链、重试、UV、权限、旧库升级和重启持久化。

浏览器脚本使用本地默认构建的 API 转发目标 5080，运行前检查该端口空闲；占用时退出，不停止已有服务。它创建独立数据库、账号和前端进程，退出时仅停止自身进程。

## 本次实际验证（2026-09-16）

- .NET Release 构建通过，0 警告、0 错误；发布输出确实包含 IPv4 / IPv6 库及许可文件。前端类型检查与生产构建通过，OpenAPI 与前端类型已重新生成。
- SQLite、PostgreSQL、MySQL、SQL Server 的 IP / 地区专项全部通过：[结果](../artifacts/f096573120/geolocation-results.json)。覆盖真实 v7 表结构升级、重复迁移、历史留空、地址变化、映射 IPv4、IPv6、可信代理链、忽略伪造正文 / X-Real-IP、访客与编辑角色拒绝、重启保留。
- 同四库的原有访问统计及咨询回归全部通过：[结果](../artifacts/2398e8f815/traffic-results.json)。这轮运行结果仍使用脚本旧标签“v6 to v7”，实际运行的新版程序与 Ready 检查为 schema 8；脚本标签现已改为“current schema”。
- 旧版 1–5 自动升级、未初始化 / 更高版本 / 缺失版本记录拒绝、迁移中断后恢复通过：[结果](../artifacts/df8c35c24b/startup-results.json)。v6 升级由访问统计回归覆盖，v7 由地区专项覆盖。
- 真实 Edge 浏览器检查通过：[日志](../artifacts/c74c056a35/browser.log)。1440 / 768 / 375 像素均验证访客列表、逐次轨迹、长 IPv6、历史“未记录”、页面不横向溢出及 DNT；已核对截图，包括 [访客列表](../artifacts/c74c056a35/visitors-1440.png) 和 [手机显示](../artifacts/c74c056a35/visitors-375.png)。
- 上述验证使用隔离测试数据，未升级日常或线上数据库；本次没有重新构建 Docker 镜像或部署线上站点。

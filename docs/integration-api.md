# Agent 与通用发布 API

后台进入 **API 访问令牌**，由管理员创建一个有名称、关联账号、权限和到期时间的令牌。完整令牌只在创建成功后显示一次；请保存到 Agent、CI 或脚本运行环境的密钥配置中。列表与日志不会返回令牌明文或哈希。

## 权限与有效期

- `content:read`：读取草稿、文章和页面列表，以及分类标签。
- `content:write`：创建和更新文章、独立页面的草稿；不改变已发布正文。
- `content:publish`：发布指定版本，内容会立即公开；此权限在后台默认不勾选。
- `asset:upload`：上传附件，继续执行文件格式、大小和引用校验。

浏览器和 Agent 共用附件、正文验证。图片、PDF 之外支持 MP4、WebM、MP3、WAV；正文支持固定格式的图片集、分栏和受限 HTTPS 框架，具体规则见 [编辑器说明](editor.md)。新增格式需同步更新 API/web，无新增 API 请求字段或数据库升级。

权限适用于站内所有文章和独立页面，没有按作者或指定文章隔离。令牌不获得账号管理、站点设置、主题、菜单、评论管理、删除或下架权限。

有效期最长一年，每个关联账号最多有 100 个未撤销且未过期的令牌。撤销不可恢复；每次请求检查过期、撤销及关联账号状态。账号停用期间不能使用令牌，重新启用会恢复尚未撤销、尚未过期的令牌；若要永久停止访问，请撤销令牌。删除账号后，其令牌无法继续使用。修改账号密码只影响网页会话，API 令牌需要单独撤销。

## 认证与请求

以 `https://itmao.club` 为未来站点地址示例，实际使用时替换为已部署地址。请求必须走 HTTPS，只有 Development 环境允许本地 HTTP 验收。

```http
Authorization: Bearer cms_<令牌标识>.<随机密钥>
Idempotency-Key: agent-job-20260914-001.draft
Content-Type: application/json
```

访问令牌通过请求头传递，不放在网址、文章或日志中。集成接口仅使用令牌；后台网页仍使用 Cookie、验证码和 CSRF。有效的后台 Cookie 不能替代集成令牌，集成令牌也不能访问后台接口。无需为 Agent 调用登录接口、解验证码或申请 CSRF Token。

## 接口

- `GET /api/v1/integration/contents?kind=post&q=关键词&page=1`：查询草稿列表，每页 20 条；`kind` 为 `post` 或 `page`。关键词须 URL 编码。
- `GET /api/v1/integration/contents/{id}`：读取完整当前草稿、版本和发布状态。
- `GET /api/v1/integration/taxonomy`：读取已有分类标签标识。
- `POST /api/v1/integration/assets`：`multipart/form-data`，文件字段名为 `file`。
- `POST /api/v1/integration/contents`：创建草稿。
- `PUT /api/v1/integration/contents/{id}`：保存指定版本的草稿。
- `POST /api/v1/integration/contents/{id}/publish`：发布指定版本。

所有写入都必须提供 `Idempotency-Key`，包括更新草稿。键长度 8–128，仅允许 ASCII 字母、数字、`-`、`_`、`.`。每个步骤使用不同键，同一步骤重试时保留原键和输入。

创建草稿示例：

```json
{
  "kind": "post",
  "slug": "hello-agent",
  "title": "Agent 发布的第一篇文章",
  "summary": "这是文章摘要",
  "html": "<h2>你好</h2><p>正文由后端执行 HTML 净化。</p>",
  "coverId": "",
  "categoryId": "",
  "tagIds": [],
  "version": 0
}
```

图片先通过附件接口上传，再把返回的 `url` 写入正文 `<img src="/media/附件标识">`，或把 `id` 放入 `coverId`。文章首次创建后，`slug` 和 `kind` 不可修改。

响应沿用 `ApiResponse<T>`：`code`、`message`、`data`、`traceId`。创建后取 `data.id` 与 `data.version`，向发布接口提交 `{"version":返回的版本号}`，并使用新的发布请求键。发布响应的 `data.content` 为发布后的内容状态，`data.path` 为站点相对路径，例如 `/posts/hello-agent`，与站点源地址组合即为阅读地址。

保存或发布遇到 `409 / VERSION_CONFLICT` 时，应先读取最新草稿并决定如何处理修改。不要自动用最新版本号强行覆盖其他编辑人员的内容。

## 超时重试与限流

去重记录保留 **24 小时**，与业务写入及成功操作日志在同一数据库事务中提交。键按令牌隔离；同一令牌下，同键同操作同输入返回原始业务结果，不再次上传、保存或发布，不增加重复操作日志。上传以文件名和实际文件内容计算指纹，不受 multipart boundary 变化影响。

同键但输入、文章标识或操作不同返回 `409 / IDEMPOTENCY_CONFLICT`。失败事务不保留成功记录，修正输入后可以重试。返回的是首次完成时的结果，不一定是文章当前状态；需要最新状态时使用 GET。`traceId` 属于每次 HTTP 请求，不参与去重。

记录随当前数据库持久化，API 重启不会丢失。24 小时后不保证去重，应先查询文章状态；不要无限期重复创建任务。过期记录在后续成功写入时清理。

每个有效令牌固定窗口限流 60 次/分钟，未认证请求按 IP 使用独立窗口。超限返回 `429 / RATE_LIMITED` 与 `Retry-After`；遵照等待时间重试，不更换请求键。失效凭据返回 401，权限不足返回 403。令牌撤销或账号停用后，历史去重响应也不能继续读取。

## 脚本示例

仓库提供仅依赖 Python 标准库的 `scripts/publish-article.py`。在运行环境中注入 `CMS_URL` 和 `CMS_ACCESS_TOKEN`，不要把密钥提交到 Git。准备 UTF-8 的 `article.html` 后执行：

```powershell
python scripts/publish-article.py --title "第一篇文章" --slug hello-agent --html article.html --request-id agent-job-20260914-001 --publish
```

不传 `--publish` 则只保存草稿。任务超时后使用相同参数、相同文件和相同 `--request-id` 重试；不同任务使用新编号。脚本不会跟随 HTTP 重定向，以免把凭据发送到其他地址。图片上传与指定分类标签可按上方接口在 Agent 工具中实现。

完整接口契约位于 [OpenAPI 快照](openapi.json)，其中集成接口声明了 Bearer 认证、所需权限、去重请求头与错误状态。后端实时 `/openapi/v1.json` 继续要求管理员会话，不开放完整后台文档给令牌。

## 升级、审计与边界

本功能使用 schema **6**。停止写入，备份数据库、附件和认证密钥，更新 API 和 web 后显式执行 `--migrate`，再启动。升级从 schema 5 增加 `cms_access_tokens`、`cms_integration_requests` 和操作日志的令牌归属字段，不重置现有站点设置。正常启动不会自动修改表结构。

后台操作记录可查看令牌创建、撤销，以及 Agent 保存、上传和发布的关联账号、令牌名称及内容对象。失败调用在后端日志中记录状态码、令牌标识与追踪编号，不记录密钥、请求头或正文。

继续限定为单 API 实例。限流窗口在进程内，重启会重置；去重与令牌在数据库中。普通事务失败会清理本次附件文件；进程在写文件后、数据库提交前被强制终止时可能留下没有数据库记录的文件，排查时应在停写和备份后核对附件目录，不应直接删除数据库正在引用的文件。多 API 实例需先补齐数据库写协调和共享限流。

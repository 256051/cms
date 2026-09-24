# n8n：资料整理 → AI 写作 → CMS 草稿

提供一条可直接导入的 [n8n 工作流](../workflows/n8n/cms-draft.json)。n8n 负责整理资料和串联步骤；AI 使用 CMS 数据库中保存的服务商配置，API Key 不需要复制到 n8n。

## 工作流

手动开始 → 主题与资料 → 整理资料 → AI 生成文章 → 准备草稿 → 保存 CMS 草稿 → 查看草稿结果。

- 在“主题与资料”填写主题、补充要求及 1–5 条资料，每条包含标题、HTTPS 来源链接和已整理的正文。此版本不会自动爬取链接，链接用于来源标注。
- 整理步骤验证长度、按来源链接去重，并将资料转换为模型输入。
- AI 节点调用 `POST /api/v1/integration/ai/generate`，复用站点的模型和 HTML 净化规则。
- 准备步骤使用输入主题作为标题，从结果文字提取简短摘要，并附上来源链接。
- 保存步骤调用现有 `POST /api/v1/integration/contents`，只创建草稿。
- 最后一步校验保存响应，返回后台编辑及草稿预览链接；查看需要登录 CMS。

只有人工点击执行才运行，没有定时器或自动发布节点。每次从头执行会创建一篇新草稿。保存节点自动重试时保持相同输入与幂等键，复用 CMS 24 小时去重机制；AI 请求不自动重试，避免重复消耗额度。业务失败会停止流程，不继续保存空文章。

## 接入已有 n8n

1. 在 CMS“AI 写作设置”中保存并测试模型配置。
2. 创建一个仅勾选 `ai:generate` 和 `content:write` 的 CMS 访问令牌。新 AI 权限默认不勾选；旧令牌不会自动获得该权限。不需要授权发布。
3. 在 n8n 导入 `workflows/n8n/cms-draft.json`。
4. 创建 **Header Auth** 凭据，Name 填 `Authorization`，Value 填 `Bearer <CMS 访问令牌>`。两个 HTTP Request 节点选择此凭据。不要把密钥写入工作流 JSON。
5. 双击“主题与资料”，填写 `cmsUrl` 和 `cmsDisplayUrl`：前者是 n8n 调用 CMS 的根地址，后者是浏览器访问 CMS 的根地址；通常相同。生产环境必须使用 HTTPS。
6. 填写主题和资料，点击 **Execute workflow**，在最后节点打开预览链接。编辑审核后再自行发布。

HTTP 节点不跟随重定向，请直接填写最终站点地址。AI 未启用、服务商配置无效、令牌过期或权限不足都会显示失败；更换令牌后在 n8n 凭据中更新即可。

## 本地演示

演示使用三个独立容器及独立数据卷：CMS API、CMS 前台/后台、n8n。仅绑定本机 `127.0.0.1:13000` 和 `127.0.0.1:15678`，不读取日常站点数据库、账号或模型密钥。

首次准备（需要 Docker Desktop 的 Linux 容器模式、Python、Node.js；仓库依赖需已安装，Node.js 用于本地验收账号登录）：

```powershell
docker compose -f deploy/n8n/compose.demo.yaml build api web
docker compose -f deploy/n8n/compose.demo.yaml pull n8n
python scripts/n8n-demo.py start
```

启动后自动创建本地演示账号和两条工作流：

- **演示 · 整理资料到 CMS 草稿（模拟 AI）**：资料整理、n8n 执行、CMS 保存均真实运行；AI 节点使用明确标注的固定排版模板，不调用外部模型，也不消耗模型额度。
- **正式模板 · 使用 CMS 数据库 AI 配置**：真实调用 CMS 的 AI 接口。先在演示 CMS 中填写服务商配置，再执行这条流程。

脚本输出工作流链接。本机账号仅保存在被 Git 忽略的 `.local/n8n-demo/state.json`，不要对外分享该文件。演示访问令牌有效期为 7 天，过期后可在演示 CMS 创建新令牌，并更新 n8n 凭据。

```powershell
python scripts/n8n-demo.py status
python scripts/n8n-demo.py verify
python scripts/n8n-demo.py stop
```

`verify` 在执行工作流之后运行，确认真实 CMS 中存在未发布的演示草稿并返回预览链接。`stop` 只停止演示项目容器，保留数据；再次 `start` 可继续查看。

本地演示使用 HTTP 开发配置，不作为生产部署配置。正式服务采用已有 CMS HTTPS 部署，并根据 n8n 官方文档部署 n8n。

## 验证

```powershell
dotnet build --no-restore
node tests/n8n-workflow.cjs
python tests/ai_writing_acceptance.py
npm --prefix web run api:types
npm --prefix web run typecheck
```

检查覆盖工作流中的真实 Code 节点逻辑、资料校验与去重、生成失败停止、草稿映射、幂等请求头，以及独立 AI 权限、旧令牌拒绝、令牌撤销和禁止发布。模型生成本身沿用 [AI 写作助手检查](ai-writing.md)，没有服务商凭据时不声称真实模型已经联调通过。

参考：[n8n HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)、[导入导出工作流](https://docs.n8n.io/build/manage-workflows/export-and-import.md)、[自托管安装](https://docs.n8n.io/deploy/host-n8n/install-options/install-using-docker-compose.md)。

# 数字商品与收款

后台新增「商品交易 → 商品销售 / 交易订单 / 支付设置」。复用原有产品详情，文章、独立页面、模块和 GrapesJS 编辑保持可用。第一版为单商品立即购买，付款后下载一份文件；没有购物车、订阅扣费、独立激活码库存或自动发邮件。联系邮箱用于订单联系，不是登录凭证。

## 配置与上架

1. 在「支付设置」填写网站的 HTTPS 根地址。分别启用需要的渠道，未配置或未启用的渠道不会出现在购买选项中。暂未取得商户账号时可以先维护产品，页面显示暂未开放收款。
2. 支付宝：开通电脑网站支付，填写应用 App ID、卖家 Seller ID、应用 RSA 私钥和支付宝 RSA 公钥。采用 RSA2 普通公钥模式，跳转收银台；不是证书模式、手机网站支付或代收平台。
3. 微信支付：开通 Native，填写已绑定的 App ID、商户号、商户证书序列号、商户 RSA 私钥、微信支付公钥及其 ID、32 字节 APIv3 密钥。采用 API v3 公钥模式，展示微信扫码二维码；没有 JSAPI / 小程序支付或沙箱模式。
4. Stripe：填写 `acct_` 开头的账户 ID、对应环境的 Secret Key 和 Webhook 签名密钥。使用 Checkout 托管收银台收取银行卡付款，商户账户必须支持所选币种。Webhook 添加 `checkout.session.completed`、`checkout.session.async_payment_succeeded`，数据对象版本选择 `2024-06-20`。
5. 在原有产品管理中保存并发布产品。在「商品销售」设置售价、币种、交付文件并勾选上架。单文件最多 50 MiB，支持软件包、资料及静态授权文件。文件独立于公开附件库。

支付宝和微信仅提供人民币。Stripe 可选择人民币、美元、欧元、港币、英镑，价格最多两位小数。后台显示的「已配置」仅表示配置字段完整，不表示商户资质、密钥或实付已验证。

通知地址由后台提供：`https://你的域名/api/v1/payments/alipay/notify`、`/api/v1/payments/wechat/notify`、`/api/v1/payments/stripe/notify`。网站反向代理必须把 `/api/` 转发给 API，通知接口不能加站点登录验证。应用自行验证支付平台签名、账号、订单、金额与币种。

## 订单、下载和退款

- 买家留下邮箱并选择渠道。服务端冻结价格、币种、商品名称和交付文件，修改售价、替换文件或下架不会改变已创建订单。
- 订单有效期一小时。Stripe 首次打开收银台需要至少 31 分钟剩余时间，不足时关闭后重新购买。付款页返回网站不代表支付成功，只有签名通知或服务端查询确认才改变状态。
- 订单凭证保存在当前浏览器，买家应点击「保存订单凭证」另存。换设备可输入凭证恢复查询；凭证不放在网址中，也不向后台回显。丢失后需联系商家人工核实处理，第一版没有自助找回或自动重发功能。
- 支付宝沙箱和 Stripe 测试订单会明确标记，**不会开放正式文件下载**。上线前必须使用自己的账户完成一次小额实付、通知、下载、关单与退款验证。
- 退款在支付平台商户后台办理，再在交易订单中核对状态。每次下载还会主动查询平台：支付宝全额退款关闭、Stripe 全额退款及微信进入退款状态会停止下载。未建模部分退款金额或退款审批；已下载到买家设备的文件无法收回。平台暂不可查询时下载会暂时失败，可稍后重试。
- 订单凭证相当于下载权限，请勿公开分享。只支持单 API 实例，扩容前需将进程内写入及结账互斥改为分布式锁。

## 部署与密钥

schema 16 只新增四张交易表，不修改原有内容表；启动时自动升级。备份包含交易表、付费文件及认证密钥，也兼容恢复旧版本备份。请保留原数据库、上传目录和 `Security:KeyPath`，丢失认证密钥会导致已保存的支付配置无法解密。备份含敏感资料，应按私有文件保管。

私钥、APIv3 Key、Stripe Secret Key、Webhook Secret 使用现有 ASP.NET Data Protection 加密保存；读取后台设置时不回显，留空保存保留原值。普通公钥不是秘密。删除部署配置不会自动删除后台保存的值。

支持现有 Consul 配置链及环境变量覆盖，例如 `Commerce__SiteUrl`、`Commerce__Channels__stripe__Enabled`、`Commerce__Channels__stripe__MerchantId`、`Commerce__Channels__stripe__SecretKey`、`Commerce__Channels__stripe__WebhookSecret`。Consul JSON 使用相同层级 `Commerce → Channels → stripe`；其他渠道为 `alipay`、`wechat`，字段名与后台一致。部署配置优先，该渠道在后台只读。不要把真实密钥提交到 Git。

## 验证

`dotnet build -c Release --no-restore`，再以全新 SQLite 路径设置 `Database__Type=Sqlite`、`Database__ConnectionString`、`CMS_COMMERCE_TEST_ROOT`，运行 `dotnet tests/Cms.Checks/bin/Release/net10.0/Cms.Checks.dll --commerce`。此检查使用测试 HTTP 传输及真实 RSA/HMAC/AES 运算，覆盖三种协议、重复请求、金额与签名拒绝、私有文件、退款、测试环境、并发关单、备份恢复；不产生真实付款。

`python tests/commerce_browser.py` 创建隔离站点并构建前端，检查上架、三渠道配置、凭证、回调鉴权、测试付款不可下载与手机页面。真实商户实付尚待提供账户后联调。

协议参考：[Stripe Webhook](https://docs.stripe.com/webhooks)、[Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create)、[微信 Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)、[微信支付公钥](https://pay.wechatpay.cn/doc/v3/merchant/4013053249)、[支付宝官方 SDK](https://github.com/alipay/alipay-sdk-nodejs-all)。

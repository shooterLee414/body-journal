# 身记 Body Journal

个人体重与腰围记录网站。使用自然语言或表单记录每次测量，查看趋势和明细，导出 Excel 可打开的 CSV。支持账号密码注册和登录，各账号的测量、图表、导出及编辑相互隔离。

## 功能

- **一句话记测量**：识别体重、腰围、中文时间和斤/公斤单位，支持分行补报。
- **保留每一次测量**：同一天可记录多次，相同数值也分别保留；网络重试不会重复写入。
- **看变化**：体重和腰围趋势、逐次变化、按时间排列的明细，支持 CSV 导出。
- **独立账号**：注册、登录、退出；查询、编辑、导出和请求重放均按账号隔离。
- **轻量部署**：原生 Node.js + SQLite，无第三方运行依赖；支持 Docker、域名 HTTPS、公网 IP HTTPS 和 SSH 隧道。

自然语言功能使用本地规则解析，不调用大模型或外部 API。仓库只包含应用代码和合成测试数据，不附带真实用户、密码或健康记录。

## 技术与目录

前端为原生 HTML / CSS / JavaScript，服务端使用 Node.js 内置 HTTP、加密和 SQLite 模块。Caddy 负责生产环境的 HTTPS 与证书续期。

```text
public/                  页面、样式、图表和浏览器交互
server.mjs               HTTP API、会话、账号隔离与数据读写
accounts.mjs             密码哈希、账号校验与版本化数据库迁移
parser.mjs               中文测量语句解析与校验
scripts/                 本地启动、数据库备份、管理员账号迁移
tests/                  解析、账号隔离、迁移和备份测试
deploy/                 域名与公网 IP 的 Caddy 配置
compose.yaml             域名 HTTPS 部署（Docker 数据卷）
compose.public.yaml      公网 IP HTTPS 部署（./data）
compose.tunnel.yaml      SSH 隧道部署（./data）
```

## 本地运行

需要 Node.js 22.13+，推荐 Node.js 24。项目只使用 Node.js 内置模块，无第三方运行依赖，无需 `npm install`。

```sh
git clone https://github.com/shooterLee414/body-journal.git
cd body-journal
node server.mjs
```

打开 http://127.0.0.1:8793 ，选择注册，填写 3–32 位字母、数字或下划线的账号，以及至少 12 个字符的密码。账号不区分大小写。macOS 也可运行 `sh scripts/start-local.sh`，它会优先使用本机 Node.js，必要时使用已安装的 Codex 运行时。

数据库默认在 `data/journal.sqlite`，属于私密本地数据，已加入 `.gitignore`。网页静态资源严格限定在 `public/`，数据库和配置不能通过 URL 下载。首次初始化可读取 `data/seed.json`，格式为下述对象数组，只导入一次。

```json
[{"measuredAt":"2020-01-01T08:00:00+08:00","weight":70,"waist":null,"source":"导入记录"}]
```

示例仅说明格式，不代表实际测量；仓库不附带个人数据。

## 环境配置

本地启动直接读取进程环境变量，不会自动加载 `.env`；Compose 使用所选环境文件。所有时间均按北京时间处理。

| 变量 | 用途 | 默认值 / 注意事项 |
| --- | --- | --- |
| `HOST` / `PORT` | Node.js 监听地址和端口 | 本地 `127.0.0.1:8793`；容器 `0.0.0.0:8787` |
| `DATA_DIR` | SQLite、种子和备份目录 | 本地 `./data`；容器 `/app/data` |
| `NODE_ENV` | 正式模式开关 | Docker 设为 `production`，启用 Secure Cookie |
| `PUBLIC_URL` | 允许写入请求的唯一来源 | Compose 自动设置为选定的外部访问地址 |
| `TRUST_PROXY` | 是否信任代理提供的客户端 IP | 仅可信反向代理后设为 `1` |
| `RESERVED_USERNAME` | 暂时保留的迁移账号名 | 可留空；该名称不能通过公开注册占用 |
| `DOMAIN` | 域名部署的站点名 | 用于 `compose.yaml` |
| `PUBLIC_IP` | 公网 IP 部署的 IPv4 | 用于 `compose.public.yaml` |

## 自然语言录入

支持常见中文表达，通过本地规则解析，不调用外部 AI 服务，也不需要 API Key。不是通用聊天机器人；无法确定的数字、计划、目标和更正指令不会直接写入。

- `75.2`：当天上午 08:00，体重 75.2 kg。
- `现在 75.2`：使用服务器当前北京时间。
- `今天下午四点50，体重150斤，腰围84厘米`：识别时间，斤转换为公斤。
- `昨天晚上八点半，腰围84`：只记录腰围，不补造体重。
- `10月6日 08:00 体重75.2`：补记具体日期。
- 多次测量分行输入，一次最多 10 条；同一天和相同数值仍各自保留。

时区固定为 Asia/Shanghai。没有时间的记录默认 08:00；“现在”使用当前时间；只写“晚上”但没有具体几点，会要求补充。日期合法性、未来时间和明显超出范围的数字会被拦截。每个输入请求使用独立标识，网络重试不会重复写入，相同数值的新汇报不被去重。

明细按日期时间排序。体重和腰围的“较上次”分别寻找上一条非空同指标记录。修改使用表格的编辑功能，旧值保留在 `revisions` 表，带并发更新检查。图表不填补未测量的数据，横轴按实际时间间隔绘制。

## 部署到腾讯云

仓库提供 Docker Compose 配置：Node.js 服务 + Caddy HTTPS 反向代理 + 持久数据卷。应先确认服务器原有服务、端口和备份，避免与现有网站冲突。

1. 在服务器准备 Docker / Compose；将自己的域名解析到服务器。腾讯云安全组和服务器防火墙应允许所用网站端口。部署前自行核实该实例地区和域名所需的备案要求。
2. 复制 `.env.example` 为 `.env`，设置 `DOMAIN` 为实际域名，例如 `journal.example.com`。不要填写 URL 或路径。
3. 在项目目录执行 `docker compose up -d --build`。Caddy 自动申请证书，需要 DNS 正确且公网可达。没有域名时可用下述公网 IP HTTPS 或 SSH 隧道配置。
4. 打开 HTTPS 网站，使用账号和密码注册、登录，不需要设置令牌。
5. 若有原单人版本的历史数据，先按下述迁移说明归属到指定账号；不要将数据交给首个注册者。

正式模式设置 `NODE_ENV=production`，会启用 Secure / HttpOnly / SameSite 会话 Cookie，以及请求来源和 CSRF 校验。HTTPS 反向代理应覆盖传入的 `X-Real-IP`；应用容器不向公网映射自身端口。注册和登录按来源地址与账号分别限速，计数保存在数据库，重启不会清空。仅在可信反向代理后设置 `TRUST_PROXY=1`。密码使用带随机盐的 scrypt 哈希保存。

### 暂无域名：公网 IP HTTPS

`compose.public.yaml` 使用 Caddy 2.11.7 和 Let's Encrypt 的 `shortlived` IP 证书，无需域名。它只对公网发布 TCP 443，通过 TLS-ALPN-01 验证地址控制权，不占用已有网站的 80 端口。数据库沿用隧道部署的 `./data`，切换时不会创建空数据库。

1. 执行 `cp .env.example .env.public`，填写实际 `PUBLIC_IP`。云防火墙允许 TCP 443，确认该端口没有其他服务。先创建 `data/` 并确保容器 UID 1000 可写；不要用宽松的全员可写权限。
2. 先备份当前数据；执行 `docker compose --env-file .env.public -f compose.public.yaml up -d --build`。
3. 查看 `docker compose --env-file .env.public -f compose.public.yaml logs proxy`，等待证书签发完成，再打开 `https://你的公网IP`。
4. 在 HTTPS 页面注册、登录。新注册账号默认没有记录，不能领取或访问其他账号的历史数据。

证书有效期约六天，Caddy 根据 CA 提供的续期窗口自动续期。保持容器运行、443 可达，保留 `caddy-data` 和 `caddy-config` 卷；首次签发成功不等于未来续期已经验证。`default_sni` 支持直接访问 IP 时不发送 SNI 的客户端。该配置使用 HTTP/1.1 和 HTTP/2，仅需 TCP 443。

公网配置只接受 HTTPS 公网地址作为写入来源；原 SSH 隧道地址不再用于登录或写入。如果回退到隧道部署，需要停止此项目的代理容器，再使用 `compose.tunnel.yaml` 重建应用，保留原数据和证书卷。不要在公网模式下把生产 Cookie 改为不安全模式。

### 暂无域名：SSH 隧道

可使用 `compose.tunnel.yaml`，服务只监听服务器回环地址，不占用其他网站端口，也不把登录表单公开在 HTTP 上。服务器上先创建 `data/`，让容器 UID 1000 可写，再执行 `docker compose -f compose.tunnel.yaml up -d --build`。本机运行：

```sh
ssh -N -L 8794:127.0.0.1:8793 <user>@<server>
```

打开 http://127.0.0.1:8794 。使用账号密码注册、登录，无需令牌。浏览器需要支持安全 Cookie 的 loopback 例外（当前 Chromium 支持）；本机到服务器之间由 SSH 加密。关闭隧道后该地址不可用，跨设备也需要建立自己的隧道。若需要手机直接访问，可切换上述公网 IP HTTPS 或域名部署。已有网站占用 80/443 时，须接入现有反向代理或使用不冲突的监听地址，不可直接启动默认代理抢占端口。

不要提交 `.env`、`data/`、数据库、备份、测量种子、登录令牌或包含个人数据的截图。源代码与实际测量数据分开管理。

## 账号与历史数据迁移

用户账号、随机盐 scrypt 密码哈希、会话和测量保存在 SQLite 数据库中，密码不明文存储。公开注册永远创建独立空账号。`/api/setup` 已停用，旧 `setup-token.txt` 即使仍留在数据目录也不能用于注册、登录或重设密码。

启动时通过 `schema_migrations` 执行一次事务迁移，保留所有旧记录和 ID。旧单人会话失效；未归属的历史记录不会出现在任何公开注册账号中。升级前备份数据库及上一版镜像，回退代码时应同时恢复匹配的数据库备份，勿让旧单人代码读取多用户数据库。

管理员可通过 SSH 运行 `node scripts/provision-user.mjs`，从标准输入提供 JSON 的 `username`、`password` 和可选的 `assignLegacy:true`。脚本创建指定账号并一次性归属所有尚未归属的旧记录，遇到已存在账号会拒绝，绝不重设密码或转移已归属记录。不要把真实密码写进代码、命令参数、仓库或日志。部署前可设置 `RESERVED_USERNAME` 防止迁移期间账号名被公开注册占用。

当前不提供邮件验证、自助找回密码或后台密码重置页面。公开注册者只能读写自己账号的数据。

## 备份与恢复

```sh
node scripts/backup.mjs
# Docker:
docker compose exec app node scripts/backup.mjs
```

公网 IP 部署请使用 `docker compose --env-file .env.public -f compose.public.yaml exec app node scripts/backup.mjs`，隧道部署使用 `docker compose -f compose.tunnel.yaml exec app node scripts/backup.mjs`。

备份使用 SQLite `VACUUM INTO` 创建一致副本，保存在数据目录的 `backups/`。备份包含测量和账户信息，需要与数据库同等保护。恢复前停掉服务并保留当前数据副本，替换数据库后再启动；不要直接覆盖仍有 WAL 写入的数据库。生产环境应另行配置私有异机备份。

## 检查

```sh
npm test
```

测试覆盖中文数值与时间、默认时间、单位转换、跨日、含糊输入拒绝、多次测量、批量原子性、登录保护、CSRF、账号间查询/编辑/导出隔离、按账号隔离的重试去重、旧数据迁移、编辑留痕与 CSV 导出。浏览器测试应使用独立 `DATA_DIR`，不要将测试测量混入个人数据库。

支持 `document.modelContext` 的浏览器还可使用 `list_measurements` 和 `record_measurements` WebMCP 工具；仍需登录、遵守同一校验规则。普通浏览器不受影响。

原有 Excel 文件独立保留。此版本迁入已有记录，但不会自动把今后网页内的记录反向写回本机 Excel，也不会自动把 Codex 聊天中的新记录同步到网站；如需要双向同步，应另行配置明确的数据源与受保护的同步接口。

## 数据存储与使用边界

账号保存在 `users`，测量通过 `records.userId` 关联账号；`sessions` 存储会话令牌的哈希，`user_requests` 以账号与请求 ID 为联合主键。`revisions` 保留更正前的记录，`schema_migrations` 记录迁移版本。

域名部署使用 `journal-data` Docker 卷，公网 IP / 隧道部署使用宿主机 `./data`。这两种存储位置不同；切换前必须显式备份、迁移并核对数据，不能直接替换 Compose 文件后假定数据库仍相同。不要执行 `docker compose down -v` 删除数据卷。

本项目用于个人测量记录，不对体重波动进行医学或脂肪变化判断。不包含邮件验证、自动密码找回、自动异机备份，也不会自动同步本机 Excel。公开注册的实际使用范围应由站点所有者自行决定。

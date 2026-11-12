# 蜻蜓FM — MyGo Music 插件

把蜻蜓FM 的频道当作播客节目、频道里的每期音频当作剧集，接进 MyGo Music 的原生播放器。

## 从 GitHub 装

仓库：<https://github.com/hhym/mygo-music-qingtingfm-main>（`plugin.json` 在根目录，应用取默认分支最新提交）

装法一：在浏览器里打开安装链接，会唤起 MyGo Music 并询问是否安装：

```
mygo-music://install-plugin?repo=hhym/mygo-music-qingtingfm-main
```

装法二：设置 → 插件 → `+`，把仓库地址 `hhym/mygo-music-qingtingfm-main` 填进去。

## 本地装法

把一个文件夹放进 MyGo Music 的插件目录就行（设置 → 插件 → `+` → 显示插件文件夹）：

```
plugins/qingting/
├── plugin.json
├── index.js
└── locales/
    └── zh-CN.json
```

也可以直接把这个目录打包成 zip，在设置 → 插件 → `+` 里选「从电脑上的文件夹或 zip 安装」。不需要编译，macOS 和 Windows 跑的是同一份 JS。

## 做什么

| 插件导出 | 对应蜻蜓FM 的东西 | 说明 |
| --- | --- | --- |
| `home` | `homepage/new` + `rank/hotSaleWeekly` | 首页给「热门」卡片（点击进排行榜），再接分类名下的频道（小说、评书、历史…），最后是分类入口 |
| `browse` | `categories/new/{id}`、`rank/hotSaleWeekly` | 排行榜页，和每个分类页 |
| `search` | `search/keyword/{kw}` | `shows` 搜频道、`tracks` 搜节目，每页 20 条，`more` 表示还有下一页 |
| `suggest` | `search/layer` | 搜索建议：先按热门词前缀匹配，匹配不上再按搜索结果取标题（带 5 分钟内存缓存） |
| `show` / `shows` / `subscribeShow` | `channels/{id}`、`player/channels/{id}/pages/{n}` | 频道详情与剧集列表，每页 30 期，订阅存在本地 |
| `stream` | `channels/{cid}/programs/{pid}` | 每次播放现取签名地址，再交给 ffmpeg 转成应用能解的 AAC-LC，落到插件数据目录 |
| `like` / `likeEpisode` / `isLiked` / `liked` | 本地存储 | 收藏的节目记在插件自己的 storage 里 |
| `played` / `recent` | 本地存储 | 最近播放 50 期 |
| `show` 的 `episodeCount` | `program_count` | 频道里的节目总数 |
| `signIn` / `signOut` / `account` / `browse` 的 `me` 页 | `user.qtfm.cn` 扫码登录 | 见下面「扫码登录」 |

专辑、艺人、歌单、电台、评论、歌词这些蜻蜓FM 没有对应东西的接口一律不导出，应用会自动隐藏对应入口。

## 扫码登录

「设置 → 账号 → 登录」会弹出一个二维码，用手机上的蜻蜓FM App 扫一下就登上了。

流程（都是网页版自己用的接口，非官方）：

| 步骤 | 接口 |
| --- | --- |
| 取二维码 | `GET https://user.qtfm.cn/u2/api/v4/users/qrcode/generate` → `code_id`，同时在 `Set-Cookie` 里给一个 `qr_skey`（JWT，8 分钟有效） |
| 二维码内容 | `https://scan.qtfm.cn/home?title=授权登录&requires_login=true&code_id=<code_id>` |
| 轮询状态 | `GET https://user.qtfm.cn/u2/api/v4/users/qrcode/status_query?code_id=<code_id>`，带 `Cookie: qr_skey=<qr_skey>` |
| 登录成功 | `qrcode_status` 变成 `authorize`，同时下发 `access_token` / `refresh_token` / `qingting_id` / `expires_in` |

插件自己不存 cookie，所以 `qr_skey` 是从生成接口的 `Set-Cookie` 里读出来，再手动放进状态查询的 `Cookie` 头；二维码也是插件自己按上面的格式拼的字符串（接口只给一张 PNG，而应用要的是能编码的文本，PNG 解出来的内容就是这一串）。

状态有三个：`init`（等扫）→ `scanning`（扫到了，等手机上确认，窗口里的提示会跟着变）→ `authorize`（登录完成 → 存 token）。`errorno` 为 200 表示二维码已过期，插件会以 `signIn` 错误提示重来；整轮最长等 5 分钟。

登录之后：

- 所有 `webapi.qingting.fm` 的请求都会带上 `Cookie: access_token=…; qingting_id=…`（移动网页就是这么带凭据的）。
- 「我的」页（账号菜单打开）显示昵称、蜻蜓 ID，以及本地订阅的频道和收藏的节目。
- 昵称和头像来自 `GET https://user.qtfm.cn/u2/api/v4/user/{qingting_id}?mode=vital&device_id=MOBILESITE&qingting_id=…`；拿不到就退回「蜻蜓听众」，不影响其他功能。

**说明白一点**：登录能让插件带上你的账号身份去请求（付费/VIP 节目的 `audioUrl` 是否下发，取决于账号本身的购买状态和接口策略）。插件不做支付，也不代替蜻蜓FM 的会员体系。

## 数据怎么对应

- **频道 → Show**：`id` 用频道数字 ID，`name` 是频道名，`episodeCount` 是 `program_count`，`publisher` 尽量从 `podcasters` 里取主播名。
- **节目 → Track**：`id` 写成 `频道ID:节目ID`，因为蜻蜓的播放接口要同时要这两个 ID；`duration` 单位是毫秒（接口给的是秒），`showId` 指向频道，`url` 指回 `m.qingting.fm` 的网页。
- 图片 URL 上常带 `!200` 这类缩略后缀，插件会把后缀去掉拿原图，交给应用自己按需缩放。

## 用到的接口

基址都是 `https://webapi.qingting.fm/api/mobile`，全部 GET、返回 JSON，请求带一个普通浏览器 UA：

| 路径 | 用途 |
| --- | --- |
| `/homepage/new` | 首页推荐，`sections[].data` 是频道卡片 |
| `/rank/hotSaleWeekly` | 本周热听榜 |
| `/categories/new/{categoryId}` | 分类页，`banner` + `recommend[].data.data` |
| `/channels/{channelId}` | 频道详情（标题、封面、简介、节目数） |
| `/channels/{channelId}/programs?version={频道v}` | 最新 30 期（无分页参数） |
| `/player/channels/{channelId}/pages/{n}` | 第 n 页节目，每页 30，带 `total` |
| `/channels/{channelId}/programs/{programId}` | 单期详情，含 `programInfo.audioUrl` |
| `/search/keyword/{kw}?page=n` | 搜索：`all` / `channels` / `programs` / `podcasters` / `live` |
| `/search/layer?keyword=` | 热门搜索词 |

`audioUrl` 形如 `https://audio.qtfm.cn/audiostream/redirect/{cid}/{pid}?device_id=MOBILESITE&t=…&sign=…`，302 到 `https://vohwod-client-sign.qtfm.cn/m4a/….m4a?auth_key=…`。插件在 `stream` 里先手动跟一次 302 拿到最终地址（拿不到就把原地址交出去，让应用自己跟），这样播放器拿到的就是可拖动的整段 m4a。

## 为什么要转码（以及为什么要装 ffmpeg）

蜻蜓FM 的音源全是 HE-AAC：24k 是 HE-AACv2（SBR+PS），64k 是 HE-AACv1（SBR）。应用内置的纯 Go AAC 解码器只吃 AAC-LC，直接播放会报：

```
go-aac/pcm: unsupported stream: SBR (HE-AAC) + ...
```

所以插件在 `stream` 里做了一步本地转码：

```
ffmpeg -i <签名 m4a> -vn -c:a aac -b:a 64k -movflags +faststart <数据目录>/qingting-<槽位>.m4a
```

- **第一次播放**要等下载 + 转码，17 分钟的一期大约 8 秒；之后同一期走槽位缓存，约 0.5 秒。
- 缓存用 8 个固定槽位循环复用（`index.js` 的 `SLOTS`），最多约 64MB，不需要删文件也能不涨。
- 需要本机装好 **ffmpeg**，并在应用设置里允许本插件运行它（`permissions.process` 申请的就是 `ffmpeg`）。没装或没授权时，插件会抛 `setup` 错误，并在后面带上具体原因。
- 桌面应用的 PATH 里通常没有 `/opt/homebrew/bin`，所以插件会按顺序试：设置里的「ffmpeg 路径」→ `ffmpeg`（PATH）→ `/opt/homebrew/bin/ffmpeg`、`/usr/local/bin/ffmpeg`、`/usr/bin/ffmpeg`（Windows 则是 `ffmpeg.exe` 和 `C:\ffmpeg\bin\ffmpeg.exe`）。都找不到就把完整路径填进设置里的「ffmpeg 路径」。
- 想退回直连，把设置里的「转码播放」填 `0`，但那样大部分内容会重新报 SBR 错。

## 播放地址怎么给

应用把 `stream` 返回的地址当 URL 解析（`internal/music/fetch.go` 的 `PathOf`），所以插件把本地文件写成标准 file URL：

- Windows：`file:///C:/Users/<用户>/AppData/Roaming/.../qingting-0.m4a`（盘符前有斜杠、反斜杠全转正斜杠、空格转义成 `%20`）
- macOS / Linux：`file:///Users/<用户>/Library/Application%20Support/.../qingting-0.m4a`

写成 `file://C:\Users\...` 会让 `url.Parse` 直接报 `invalid port ":\\Users..." after host`，播不出来。

## 已知限制

- **付费/VIP 节目**：接口不给 `audioUrl`，插件会抛 `unavailable`，提示「这个节目需要购买后才能收听」。扫码登录后请求会带上账号，但能不能播仍取决于这个账号本身买没买；插件不做支付。
- 转码后会有一点音质损失（源本身 24kbps，转到 64k AAC-LC 只是去掉 SBR，不会变好）。
- **直播电台**（`type: live`）没有做——直播流是另一套 HLS，且不是点播语义。
- 蜻蜓的 API 没有歌词和评论，所以插件没有 `lyrics`、`comments`。
- 频道节目列表只有 `player/channels/{id}/pages/{n}` 可分页，`channels/{id}/programs` 永远只给最新 30 期，所以插件用前者。
- 这是非官方接口，蜻蜓改字段或加签名时插件需要跟着改。
- 扫码登录是网页版的接口，扫码、确认这两步动作得在手机上完成（本应用里只显示二维码和提示）。

## 开发备注

`plugin.json` 里申请的域名是 `webapi.qingting.fm`、`api2.qingting.fm`、`audio.qtfm.cn`、`*.qtfm.cn`、`user.qtfm.cn`——少了任何一个，`fetch` 都到不了（`user.qtfm.cn` 是扫码登录用的）。

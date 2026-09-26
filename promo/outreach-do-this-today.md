# 今天要做的三件事 —— 打开哪个网址、点什么、粘贴什么

> 英文原文已经写好，你只需要**复制粘贴**。按 ①②③ 顺序做，做完一件打个勾。
> 下面每个网址我都从你这台电脑实测过能否打开，结果写在每一项里。

## 先看总表

| 顺序 | 发给谁 | 在哪发 | 大概花多久 | 值不值 | 从你的网络能打开吗 |
|---|---|---|---|---|---|
| ① | **Privacy Guides**（隐私指南，权威推荐站） | 它的论坛发一个帖 | 20 分钟 | ★★★ 最高，可能是唯一真能提升权重的 | 有时第一次打不开，**刷新几次就行** |
| ② | **Web Tools Weekly**（1.5 万人订阅的开发者周刊，纯策展人） | Bluesky 私信 | 15 分钟（含注册 Bluesky） | ★★ 让人发现 | ✅ 打得开（实测 4 次全成功） |
| ③ | **nouploadtools**（工具目录站） | 它的提交表单 | 2 分钟 | ★ 只有人能看到，不算权重 | 偶尔打不开，刷新一下 |

**为什么 ① 排第一**：它的推荐链接实测**传权重**（全页没有一个 nofollow），而且它不卖任何跟我们竞争的东西；有一个用户当天注册当天就发帖成功了——门槛不高。

---

## ① Privacy Guides —— 今天必做

### 为什么是它

- 它的工具推荐是真推荐（不收费、不放联盟广告），所以只要被收录就是硬认可
- 它有两个正好对口我们的分类：**Photo Management**（图片管理）、**Data and Metadata Redaction**（元数据清除）
- 论坛支持**用 GitHub 账号直接登录**——你已经有 GitHub 账号，不用再注册新账号、不用等邮箱验证

### 操作步骤

**第 1 步：打开论坛**
网址：<https://discuss.privacyguides.net/>
打不开就刷新几次（我实测过是间歇性的，不是被墙）。

**第 2 步：登录**
点右上角 **Log in** → 选 **Log in with GitHub** → 用你的 GitHub 账号（biren001）授权。
> 如果它让你补一个邮箱或用户名，照填即可（填你的 GitHub 用户名 biren001 最省事）。

**第 3 步：进入正确的版块**
网址：<https://discuss.privacyguides.net/c/site-development/7>
（版块叫 **Site Development**。所有工具自荐都发在这里，我核对过现有帖子的格式。）

**第 4 步：发新帖**
点这个版块右上角的 **+ New Topic**。

- **标题栏**只填这一行（照抄，别改）：

```
LocalPhotoTool (Browser-Only Image Tools)
```

- **正文栏**粘贴下面整段（从 `Hi all` 开始，**不要**把标题那行也粘进去）：

```
Hi all — self-submitting a tool I built, following your self-submission process.

Affiliation: I am the developer of LocalPhotoTool. Full disclosure up front.

What it is
----------
A static site of browser-only image tools: compression (JPEG/WebP/AVIF/PNG), HEIC->JPG,
HEIC conversion, target-size compression (e.g. "compress to 500 KB"), EXIF/GPS stripping,
and phone<->computer file transfer. All processing happens in the originating browser
via Canvas/WebAssembly. Source: https://github.com/biren001/localphototool (MIT).

Threat model
------------
Protects against: your photo being transmitted to, stored by, or logged by a third-party
operator, plus the metadata that survives ordinary compression (GPS coordinates, serial
numbers, software timestamps).

Does NOT protect against: a compromised device, a malicious browser extension, or a
screen recorder. Nothing here can help once the bytes are in someone else's runtime.

What it provides
----------------
- Zero bytes uploaded: the page ships no upload endpoint, no analytics, no cookies.
  There is nowhere for the image to go.
- A strict Content-Security-Policy that blocks outbound requests to anything other than
  the codecs the page itself loads — verifiable from the response headers.
- Works offline after first load (service worker); no account, nothing stored server-side.

What it cannot provide
----------------------
Not a pixel editor, no cropping, and the EXIF stripping path strips metadata by
re-encoding, so it is lossy by design (the page says so explicitly rather than burying it).

Why it over the alternatives
----------------------------
The field's interesting property is that most "private" competitors are private by
policy rather than by construction. I published the measurement rather than asking anyone
to take the claim: which tools actually transmit the file, to which endpoints, and how many
bytes — https://localphototool.com/image-compressor-upload-test/ has the reproducible probe
generator, the measurement script and the raw per-site JSON. You can re-run it and get a
different answer; that is the point.

Happy to answer anything, and to hear what would need to change for this to meet your bar.
If it does not belong, no hard feelings.
```

**第 5 步：点 Create Topic 发布。** 然后关掉页面，**一周内不要催**。

### 注意

- **不要修改措辞**。这段话是专门按它的评审标准写的：开头主动说明"我是开发者"（他们要求披露），主动说出自己做不到什么（这个社区最反感吹嘘），把重点放在可验证的测量数据上。
- 如果点 New Topic 提示权限不够，先去论坛随便读几篇帖子停留 10 分钟，再回来发。
- 发布成功后**把帖子网址发我**，我记进追踪表。

---

## ② Web Tools Weekly —— 用 Bluesky 私信

### 为什么走 Bluesky

他的官方提交页（webtoolsweekly.com/submit）只给两个渠道：**X 私信** 和 **Bluesky 私信**。
X 在国内用不了，**Bluesky 实测能打开**（我连续测了 4 次全部成功）。所以走 Bluesky。

他本人是纯做策展的（ newsletters + 书籍），**没有自家竞争对手产品**，链接给谁对他零成本——这类人最好说话。

### 操作步骤

**第 1 步：注册 Bluesky**（如果已有账号请跳过）
网址：<https://bsky.app/> → 点 **Create account** → 用邮箱注册（免费，1 分钟）。
> 用户名随便起，比如 `localphototool.bsky.social` 之类。

**第 2 步：打开他的主页**
网址：<https://bsky.app/profile/louislazaris.com>

**第 3 步：发私信**
点页面上的 **Chat** 或消息图标 → 进入私信 → 粘贴下面这段 → 发送。

```
Hi Louis — tool suggestion for Web Tools Weekly (not an article):

LocalPhotoTool (https://localphototool.com) — browser-only image tools:
compress JPEG/WebP/AVIF/PNG, convert HEIC, hit an exact target size
("compress to 500 KB"), strip EXIF/GPS, and phone<->computer file transfer.
Zero bytes uploaded, no account, no analytics, no cookies, works offline.
Open source, MIT: https://github.com/biren001/localphototool

The claim is checkable: https://localphototool.com/image-compressor-upload-test/
— I measured what nine popular compressors actually transmit, and published
the probe generator, script and raw JSON so anyone can re-run it.
```

### 注意

- **他明确规定的红线：只收工具，不收文章/教程。** 所以上面这段话是"介绍工具"的口吻，最后一句只是解释"为什么这个工具值得信"，不是推销文章。
- **私信尽量别改**，它已经写得很短（Bluesky 私信有长度限制）。
- 他的其他 newsletter（VSCode.Email、Tech Productivity）**不对口，不要顺手发**。
- **如果新注册的 Bluesky 提示不能发私信**（平台对新账号有时限制），改用备用方案：
  去 <https://webtoolsweekly.com/> 订阅（页面顶部填邮箱），收到任何一期邮件后**直接回复那封邮件**，粘上面这段。注意：订阅表单带 Google 人机验证，**需要开着 VPN 才能过**。

---

## ③ nouploadtools —— 2 分钟，顺手做

**先说清楚**：这个站我实测过，它的列表链接走内部跳转、还被它自己的 robots.txt 屏蔽，**搜索引擎爬不过去**——所以只有人能看到我们，**不算外链权重**。免费就顺手做，**绝对不要付钱**。

**操作步骤**：打开 <https://nouploadtools.com/submit>（偶尔打不开，刷新几次），把下面内容填进表单：

```
Name: LocalPhotoTool
URL: https://localphototool.com
Category: Privacy-First Image Tools
Description: Browser-only image tools — compression, HEIC conversion, target-size
compression, EXIF/GPS stripping and P2P transfer. Nothing is uploaded: no server-side
processing, no account, no analytics, no cookies. Works offline after the first load.
Source: https://github.com/biren001/localphototool
```

---

## 发完之后

1. **一周内不要追问**（这三家都明确反感催promotion）。
2. **把结果告诉我**：发给了谁、什么时候、对方回没回、回了什么。我记进 `outreach-targets.md`。
   —— 哪种说法有人回，这个信息比单个链接更值钱。
3. 如果哪一步卡住了（登录报错、找不到按钮、网址打不开），**把截图发我**，我立刻处理。

---

## 绝对不要发的地方

**orthogonal.info 不要发。** 它卖的是和我们一样的东西（自家的 QuickShrink 压缩器、PixelStrip 元数据清除工具），那篇"5 款压缩器评测"就是给它自家产品引流的。给它投稿等于把我们的测量方法免费教给竞争对手。

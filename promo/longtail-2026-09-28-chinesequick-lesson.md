# 长尾词矩阵：chinesequick 能不能抄？（2026-09-28 实测）

用户提出：chinesequick.com 有很多长尾词页面，被 Google 看见了 —— localphototool 应该照做。

**结论（经过两轮自我推翻后的最终版）：方向对，但「抄数量」是错的——该抄的是「每页一个别人答不了的问题」。**

本文件里有两个判断已被自己的实测否掉，**保留原文并在 §四/§附三 里标出**，因为「怎么错的」本身是资产：

1. ❌ **「Bing inIndex=4 → Google 也不要我们」** → GSC 显示 Google 收录 **8** 页。Bing 比 Google 保守得多，
   拿 Bing 替 Google 下结论是越界。（见 §附二）
2. ❌ **「3 页未收录 = 4 个 KB 档位页互相重复（doorway）」** → GSC 给出真实那 3 页，
   **没有一个是 KB 档位页**；而那对 74% 相似的 KB 页**恰恰被收录了**。相似度不是判别标准。（见 §附三）

**修正后的真原因：我们的长尾是「commodity」。** 见 §附四 —— 实测两条目标查询，每条的前 5 名
**全是同一套模板的复制站**（`convert.now` / `stopbyte.com` / `fastdatatools` / `imgtweak` / `filegod` …，
连 FAQ 问题都逐条相同）。Google 已经有了 5 个以上代表，我们的 `/png-to-jpg/` 只是第 6 份拷贝。
→ 所以 **chinesequick 能成立、我们不能照抄**，差别不在页数，而在**它的每页回答的是一个别人没写过的问题**。

---

## 一、chinesequick 实测：133 URL，105 个模板页

`/sitemap.xml` = 133 条，其中 **105 条是 `/how-to-say-<短语>-in-chinese/`**。

单页形态（抽 3 页实测）：

| 项 | 值 |
|---|---|
| 正文词数 | 334 / 374 / 403 |
| 字节 | 39–45 KB |
| schema | BreadcrumbList + **FAQPage（3 问）** |
| h2 骨架 | Word by word · When you use it · Other ways people say it · **What usually trips people up** · Common questions · Where you'll use it · **More Restaurant phrases** |

三个真正让它成立的结构点（不是「105」这个数字）：

1. **URL slug = 用户会打进搜索框的那句话**，零语义鸿沟。
2. **每页一套固定骨架**，其中 `What usually trips people up` 是**竞品没有的信息增量段**；
   FAQ 答案直接由数据字段拼成 → Google 摘正文当 SERP 摘要（已实证）。
3. **每页底部有同分类推荐块**（`More Restaurant phrases`）→ 105 页不是 105 个孤岛，
   爬虫从分类 hub 一步能到全部。

## 二、我们的赛道：对手已经在做同样的事

搜 `compress image without uploading to server`，前 5 名：

1. openconvert.net（187 URL，但 = 22 个工具 × 8 语言）
2. imgtoolsstack.com
3. haventools.dev
4. localsquash.com（7 URL）
5. **privateimagecompressor.com** —— 18 URL 里 **15 篇 article**

`privateimagecompressor` 的文章矩阵：gdpr-risks / compress-without-uploading /
compress-for-web / jpg-vs-png-vs-webp / client-side-compression / is-tinypng-safe /
compress-to-size / compress-for-email / reduce-file-size / avif-vs-webp /
compress-for-social-media / best-image-compressors / local-image-compressor /
make-picture-file-smaller / image-compressor-alternatives。

**两个可直接用的信号：**

- 它的 URL 是 `/pic-article-7-compress-to-size.html` —— **带编号的后期批量 slug**。
  我们的 `/compress-to-50kb/` 比它好一个量级。这条我们**已经赢**，不用改。
- 它 15 篇里绝大多数是**问题型**（is X safe / risks / vs / alternatives），
  我们 18 页里**几乎全是工具型**。这是真实的内容缺口（见 §五·B）。

## 三、我们自己的实测：三个「不是原因」的排除

| 怀疑 | 实测 | 结论 |
|---|---|---|
| 爬虫走不到？ | 从首页 BFS：**0 孤岛**，18 页全部 depth=1，每个长尾页 18 个入链 | ❌ 不是 |
| 内容太薄？ | 正文（仅 `<main>`，去 nav/footer）**1109–1360 词**，FAQ **x6** | ❌ 不是（比 chinesequick 的 334–403 词厚 3 倍） |
| 提交没做？ | sitemap 已提交、IndexNow 已推 18 条、Bing 配额 100/天 | ❌ 不是 |

**真正的原因（Bing Webmaster API 实测，2026-09-28）：**

```
crawl:   crawled 0 / 3 / 14 页（三天）   inIndex 一直 = 4
urlinfo: 15 条里 12 条 "no record at all"
首页:    AnchorCount = 0
```

**爬了，但不索引。** 外部权威信号为零是这个数据唯一的解释。

## 四、相似度：一个需要盯着的数字

四个 KB 档位页两两 Jaccard（只看实词）：

```
50kb × 100kb  54%     100kb × 200kb  57%
50kb × 200kb  54%     100kb × 500kb  54%
50kb × 500kb  52%     **200kb × 500kb  74%**   ← 偏高
```

不是「换数字」级别（四页共有词 260，各自独有 145–184），但 **200KB vs 500KB 的 74% 已经在
doorway 的边缘**。→ **不要再往这个方向加档位页**（W3Schools 已上线 10/20/50/100/200/500KB/1/2MB 全套）。

## 五、该做什么

### A. 先确认真相源（用户做，5 分钟）
上面所有收录数据都来自 **Bing**。用户的观察来自 **Google**，两者不是一回事，而我们
**GSC API 在大陆不可达**。→ 去 GSC 看「网页」报告的实际收录数：
- 若 Google 已收录 15/18 → Bing 的推断不适用，瓶颈另有其因，策略要改；
- 若 Google 也只有 3–4 页 → §三 的结论成立，**先修收录，别加页**。

顺手：GSC「网址检查」→ 对 12 条没收录的逐个「请求编入索引」（无需 API，人工一次到位）。

### B. 真正能抄 chinesequick 的两条（不是加页）
1. **补「问题型」长尾页**，而不是再补工具页。且**只补我们手上有实测数据、别人写不出来的**：
   - *Do online image compressors upload your photos?* → 已有 `/image-compressor-upload-test/`（9 家实测）
   - *Is TinyPNG safe?* / *Which compressors keep files on your device?* → 同一份实测数据可派生
   - *What happens to my photos after I use an online compressor?* → 同上
   竞品写这些题是**讲道理**，我们能**给数据**。这才是 chinesequick 那条「竞品没有的信息增量段」的正确迁移。
   → **§附四 给了这条更硬的依据**：模板农场已经把「讲道理 + 可验证语气」也学会了，**只有真数据还抄不走**。
2. ~~**把「全站页脚」升级成「相关性内链」**：我们 18 页互相全链（每页 18 个入链 = 相关性信号为零）~~
   → **这条的前提是错的，已修正。** 实测：KB 档位页簇**早就有**分类内链块
   （`Other budgets in one place`，一段里带 4 个描述性锚文本）——即 chinesequick 第 3 条**已经实现了**。
   **真正的缺口只有一个**：`/png-to-jpg/` 是全站唯一在别人正文里「一次都没被提到」的内容页。
   → **已修（v38）**：三个格式转换页补上同款 `Other conversions` 段落，互相成网。见 §五·D。

### C. 不要做
- 再来 N 个 `compress-to-Xkb` 档位页（W3Schools 已占全套；**另：别再用「相似度」当理由**，见 §附三）。
- **别去正面撞模板农场已占的查询**（`png to jpg`、`compress for email` …，见 §附四）——
  这类页写了也是「 crawled but not indexed 」。
- 在收录问题解决前批量扩页 —— 已爬过的 14 页都没进索引，新页只会重演。
- **别去「救」`/share/`** —— 189 词、无搜索需求，Google 不收它是正确判断，不是故障。
- 继续 A 路之外的变现尝试（与隐私承诺冲突）。

### D. 本轮已做的事（v38，待上传）

**唯一被实测点名、且机制干净的那一处：`/png-to-jpg/` 是内容图孤儿。** 已修：

| 文件 | 改动 |
|---|---|
| `png-to-jpg/index.html` | 补 `<h2>Other conversions</h2>` 段，链 `jpg-to-webp` / `heic-to-jpg` / `compress` |
| `jpg-to-webp/index.html` | 同上（链 `png-to-jpg` / `heic-to-jpg` / `compress`） |
| `heic-to-jpg/index.html` | 同上（链 `png-to-jpg` / `jpg-to-webp` / `compress`） |
| `sw.js` | `VERSION` v37 → **v38**（三页都在 SHELL 预缓存清单里，不升版本老访客继续吃旧页） |

实测效果（`_dev/.tmp/lpt-inlinks2.cjs`）：`/png-to-jpg/` 的「正文内入站」**0 → 2**，
三个转换页由三片叶子变成一个互链的簇。

校验：`check-listing-copy` 42/42 · `test-pages` 121/121 · `test-pwa` 54/54 ·
`test-headers` 5/5 · `audit-nav` 36/36 · `audit-overflow` 干净；
`package-zip + verify-zip`（双向 diff 空）+ `check-packaged` 全过（57 文件 / sw v38 / sha 一致）。

> **期望值别拉高**：这修的是一个真实缺陷，不是流量开关。3 页会不会因此被收，
> 取决于站点权威，而权威仍然 = 0。**真正的杠杆还是外链。**

## 附二：GSC 真相（2026-09-28 用户截图）—— 上面的 Bing 推断要修正

| GSC 项 | 值 | 读法 |
|---|---|---|
| **已编入索引** | **8** | Google 实际收录 8 页 —— **比 Bing 的 3–4 页好一倍** |
| **已抓取 - 尚未编入索引** | **3** | 与 §三 的现象一致，Google 也报了同一种状态 |
| 网页会自动重定向 | 2 | `http://www.` + `https://www.` → **正确的 301，不要动** |
| 已知总数 | 13 | sitemap 18 页里还有 **5 页 Google 完全没提** |
| 效果（24h） | 2 曝光 / 0 点击 / **平均排名 5** | 已经有词在排第 5 名 |

**两点修正：**

1. **Bing 比 Google 保守得多。** 用 Bing 的 `inIndex=4` 推断「Google 也不要我们」是**过头**了。
   → 但 §三 的结论没变：**「爬了但不索引」两个引擎都在报**，只是 Google 的程度轻。
2. **真相源只能是 GSC**，Bing 只能当趋势参考。这条已写进 MEMORY.md。

### 新增诊断（同日）：找「已抓取-尚未编入索引」那 3 页的元凶

`_dev/.tmp/lpt-indexdiag.cjs` 逐页查索引前置条件：

- **全绿**：18 页的 meta robots 都是 `index, follow, max-image-preview:large`，
  canonical 全部自指，**没有任何意外 noindex** → 不是技术原因。
- 正文规模：`/compress/` 2434 词、`/` 1701、`/heic-to-jpg/` 1432……
  **只有 `/share/` 是 189 词**（扫码分享工具页，属正常）。

> ⚠️ **本节下面的「真嫌疑 = KB 档位页相似度」判断已在 §附三 被实测否掉。** 保留原文只为记录推理过程。

---

## 附三：那 3 页的真实身份（2026-09-28 用户 GSC 截图）—— **我的 doorway 假设被否掉**

GSC「已抓取 - 尚未编入索引」示例里列出的真实 3 页：

```
https://localphototool.com/compress-photos-for-email/   上次抓取 2026-09-22    正文 1146 词
https://localphototool.com/png-to-jpg/                  上次抓取 2026-09-20    正文 1015 词
https://localphototool.com/share/                       上次抓取 2026-09-20    正文  189 词
```

**没有一个是 KB 档位页。** 逐页实测（`_dev/.tmp/lpt-parked3.cjs`）：

| 页 | 正文词数 | H2 | 最像的邻居 | 判定 |
|---|---|---|---|---|
| `/compress-photos-for-email/` | 1146 | 13 | 43.6% → `/compress-to-200kb/` | **不是** doorway、**不是**薄页（独占词 48） |
| `/png-to-jpg/` | 1015 | 13 | 46.9% → `/jpg-to-webp/` | 同上（独占词 22） |
| `/share/` | **189** | 6 | 10.0% → `/png-to-jpg/` | **真薄页**（独占词仅 5），且无搜索需求 |

**结论：相似度不是判别标准。** 被停的是 43–47% 的页，被收的里反而有 74% 的一对。
→ §四 那段「74% 已在 doorway 边缘」的推理**降级为一条自查提醒**，不再作为「这 3 页为什么没收录」的解释。

**同时被否掉的还有一条**：`/share/` 189 词**不是**元凶之一——它确实被停，但它是三页里唯一
「本来就没有搜索需求」的工具页，被停是**正确行为**，不该去救。

### 那真原因是什么？——只剩一个干净的相关性

`_dev/.tmp/lpt-inlinks2.cjs`（按页解析 URL，**区分正文内链接与 nav/footer 样板**）实测：

```
/png-to-jpg/   被别的页「正文」链到的次数 = 0     ← 全站唯一一个内容页为零
其它 17 页     1 ~ 18（其中 / 的 18 里大多是面包屑）
```

→ **`/png-to-jpg/` 是内容图里的孤儿**：它只在导航/页脚里存在，**没有任何一页的正文提到它**。
另外两页（`/compress-photos-for-email/` 3 次、`/share/` 10 次）不是这个问题。

> 顺带发现：**两套方法的结论会差很远。** 最初用 `href="/` 正则统计，得出「全站正文内链 = 0/19 页」——
> 那是**假发现**，因为本站站内链接写的是相对路径 `../compress/`。**统计任何站的链接，必须做真正的 URL 解析，
> 不能匹配字符串**；而按「是否在 `<main>` 内」分类也几乎无意义（Google 不看语义标签，只看实际位置与锚文本）。

## 附四：真正的坏消息 —— 我们想抄的那批长尾，是模板农场的地盘

用两条目标查询实测 SERP（WebSearch，2026-09-28）：

**`png to jpg without uploading browser converter` 前 5 名：**
`convert.now/png-to-jpg` · `dataconversioncenter.com/image-tools/png-to-jpg/` ·
`stopbyte.com/tools/png-to-jpg` · `imagetourl.cloud/vi/png-轉-jpg` · `fasttasktools.com/image-tools/png-to-jpg-converter`

**`compress photos for email attachment limit without uploading` 前 5 名：**
`alldaytoolkit.com/compress-image-for-email` · `imgtweak.com/compress-image-for-email` ·
`filegod.app/compress-image-for-email` · `image-compressor.uk/compress-images-for-email` ·
`compressfiles.online/compress-image-for-email`

**它们不是 5 个竞品，是同一套模板的 5 份拷贝**：同样的 PNG-vs-JPG 对照表、同样的三步 How-to、
同样的「files never leave your device」、**连 FAQ 问题列表都逐条相同**
（*What happens to transparent areas?* / *Which quality should I use?* …）。

三条可直接用的结论：

1. **这两类查询 Google 已经有 5+ 个代表**，我们的 `/png-to-jpg/`、`/compress-photos-for-email/`
   进去只是第 6 份，**被「 crawled but not indexed 」是合理结果**，不是我们做错了什么。别跟它硬碰。
2. **`convert.now` 的文案手法和我们几乎一样**（"Open DevTools' Network tab to verify"）。
   → **「用可验证的语气写」不再是差异化**，模板农场已经学会了。**唯一还站得住的是真数据。**
3. **`image-compressor.uk` 写着 "Typical reductions are 60–85%"** —— 和我们 v37 刚退役的
   `60–90%` 同一个毛病（对照片不成立）。**这类数字满街都是，我们手上那份「真照片实测 24–68%」反而是稀有的。**

→ **这就是 chinesequick 教训的正确迁移**：它 105 页每一页回答的是**一个别人没写过的具体问题**
（某个中文短语怎么用）；我们的「PNG→JPG」回答的是别人写了 5 遍的问题。**要抄的是「每页一个独家问题」，不是「105 页」这个数字。**

### 校验记录
- `/image-compressor-upload-test/`（唯一护城河页）在诊断脚本里首次探针 `status=0`
  → **复测 5 次全 200**，是链路抖动。**单次探针不得当作结论**（既有规则第 N 次生效）。
- `bing-webmaster.cjs sites`：该 API key 下只有 `localphototool.com` 和 `aivisnap.com`，
  **没有 chinesequick**（所以没法用同口径对比两站）；`aivisnap` 近三天 `CrawledPages=0 / InIndex=0`，不作对照。

## 附：本次实测脚本

- `_dev/.tmp/cq-recon.cjs` → chinesequick 的 sitemap / slug 模式 / 单页骨架
- `_dev/.tmp/lt-recon.cjs` → 4 个竞品站点的 sitemap 规模
- `_dev/.tmp/lpt-linkgraph.cjs` → 从首页 BFS 的内链可达性与孤岛
- `_dev/.tmp/lpt-similarity.cjs` → 长尾页正文词数 / FAQ 数 / 两两相似度
- `_dev/.tmp/lpt-parked3.cjs` → **GSC 点名的那 3 页**逐页画像（词数/独占词/H2 大纲/最近邻居）→ §附三
- `_dev/.tmp/lpt-inlinks2.cjs` → **逐页区分的正文内 vs 样板站内链接**（做真正的 URL 解析，含反向表）→ 全文最有用的一支
- `_dev/.tmp/lpt-inlinks.cjs` → ⚠️ **已废弃**，它用 `href="/` 匹配字符串，漏掉相对路径，产出过「全站正文内链=0」的假发现

> ⚠ `_dev/bing-webmaster.cjs urls --apply` 本次报 `ECONNRESET`（host ssl.bing.com）。
> 按既有规则，**单次传输失败不得当作接口不可用**，需换时间重试；配额 100/天仍在。

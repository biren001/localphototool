# 竞品差异点与痛点拆解 — 2026-10-04

> 触发：用户要求「继续分析全网竞品，找出差异点，找出痛点，都融合到我这个网站」。
> 本文记录**本轮落进产品里的那部分**（不是又一次调研汇报）。凡是没落地的，单独列在 §六，
> 不当作差异点用。所有数字都能在本仓库 `_dev/` 里复现。

---

## 一句话结论

这一轮没有写新文案，先量了旧能力，结论是：**竞品的差别不在「能压多少」，在「压不动的时候它做什么」。**

- 五家竞品的宣传页都在讲百分比；**没有任何一家公开回答「为什么我的图第二次压不动」**；
- 这一条恰好是用户抱怨最集中的地方，而且**可以用自家引擎实测出来**——我们做了，
  三张 2400×1600 照片同格式同质量连压三遍，**总字节 1,368,828 → 1,368,713，只省 115 字节**；
- 于是它从「一句抱怨」变成了**一个站得住的答案 + 一个页面 + 一个常驻体检词表**。

---

## 一、调研方法（四条独立证据，各自可复核）

| # | 证据 | 产出 | 状态 |
|---|---|---|---|
| 1 | 竞品页面/宣传页逐家读（appsupports、alldaytoolkit、zooz engineering、go-tools.org、agihunt 等） | 「压完变大 / 看不到分辨率 / 一次一张 / 每日限额 / 怕传到陌生服务器 / lossless 标题党」六类痛点 | 已工程化 |
| 2 | 竞品评论与问答里的原话 | 覆盖体检词表 `_dev/coverage-check.cjs` 的 `compress-pain-points` 组（20 条） | 已工程化 |
| 3 | 上传行为实测（v78 已做，15 家） | `/image-compressor-upload-test/` 的 EXIF 标记串证据 | 保留原口径 |
| 4 | 二次压缩实测（本轮新增 `_dev/measure-recompression.cjs`） | 115 字节 + PSNR 掉 0.00–0.14 dB + 同像素 PNG 反而大 104%/191%/50% | 已做进页面 |

**口径纪律（别破坏）**：第 3、4 项测的是不同东西（上传 vs 重编码），共用同一套范式
（直接驱动 `window.LPT.engine`，不走 devtools 协议、不走 UI 点击），**不新造第二套字节统计**。

---

## 二、差异矩阵（本轮复核后的事实）

| 差异点 | 竞品常见做法 | 我们 | 证据 |
|---|---|---|---|
| 文件去哪 | 多数要传到自己的服务器 | 浏览器内完成，无上传 | `/image-compressor-upload-test/` 15 家实测 |
| 压不动时 | 照常给一个「新文件」（多半更大） | 标 `already optimal`，**交回你上传的原始字节** | `app.js` 的 `worse ? item.file : result.blob` |
| 前后对比 | 多数只给最终图 | 逐文件给「源 → 结果 → 省了多少」+ 可打开对比 | `/compress/` |
| 批量 | 多数一次一张 | 整个文件夹一次跑完，无数量上限、无每日限额 | 各工具页正文 |
| 格式诚实度 | 「lossless compress」当卖点 | Auto 是有损带保底；PNG lossless 会**变大**并明说 | `/why-my-image-wont-get-smaller/` |
| 二次压缩 | 无人解释 | 有页面 + 有实测 + 给三个真杠杆 | 同上 |

⚠️ **未证实，别引用**：本轮没有再去逐家读竞品的定价/条款页，也没有重跑上传测试；
「多数」「常见」指的是宣传层读取时的观感，**不是逐家实测的统计**，不要写成「我们测了 15 家竞品都这样」。

---

## 三、痛点 → 落地位置（每一条都能点回去）

| 用户原话（进词表的那几条） | 落点 | 口径 |
|---|---|---|
| "won't get smaller" / "not getting smaller" | 新页 h1 + FAQ 第 1 条 | 实测数字 |
| "came back bigger" / "bigger than before" | `/compress/` 新章节 + FAQ | 115 字节那张表 |
| "already optimal" / "original bytes" | 结果行文案 + why-my 页 | `app.js` 已实现 |
| "media library" / "by hand" / "one at a time" | why-my 与 compress 两页 | 批量能力说明 |
| "random server" / "daily limit" | why-my 页新增段 | 无上传、无账号、无日限额 |
| "run it again" / "compress it again" | why-my 页新增段（明说第二遍不会动） | PSNR 0.00–0.14 dB |

---

## 四、115 字节是怎么量出来的

```
node _dev/measure-recompression.cjs
→ _dev/measured/recompression.json   （原始输出归档，不是 scratch）
```

- 三张 2400×1600 照片（`-hq.jpg`），同格式、同质量、连续压三遍；
- 每轮都**跟原始像素比 PSNR**，而不是跟上一次比——否则「变小了」会藏住「掉了质量」；
- 结果：总字节 **1,368,828 → 1,368,713（−115 B，0.008%）**，
  第二/三遍相对原始只掉 **0.00–0.14 dB**（中位 0.03 dB）；
- 同像素转无损 PNG：**+103.9% / +191.4% / +49.5%** 于源 JPEG。

**为什么这条值钱**：竞品在宣传页讲百分比，这个数字讲的是「百分比到头是什么样」，
而且**任何人拿我们的引擎都能复现**——复现不了的就不是证据。

---

## 五、已上线清单（本轮）

1. `localphototool/why-my-image-wont-get-smaller/` — 新信息页（内嵌压缩器 + 实测表 + 7 条 FAQ）；
2. `/compress/` 新增「When the file is already as small as it gets」章节 + 1 条 FAQ（13 → 14）；
3. 全站 29 个含页脚的页面 nav/footer 挂上新页链接（`_dev/add-page-nav-footer.cjs`）；
4. `_dev/coverage-check.cjs` 新增常驻组 `compress-pain-points`（20 条竞品原话）+ ALIAS；
5. 8 处同步登记：sitemap / sw.js SHELL / test-pages / llms.txt / sync-faq-schema PAGES / package-zip；
6. 新页正文补的竞品说法变体把 why-my 的痛点覆盖率从 **10/20 提到 19/20**。

校验：`test-pages 182/182`、`audit-faq-sync 0 页需补登记`、`check-listing-copy 42/42`、
`audit-nav 36/36`、`e2e-v79 44/44`、`audit-overflow 390px 全站不横滑`。

---

## 六、还没落地（**不要算作差异化**）

| 空位 | 状态 |
|---|---|
| PDF 压缩页（唯一还没被占的压缩形态） | **v80 已上线**，见 `promo/pdf-compressor-notes-2026-10-04.md` |
| `/pdf-to-jpg/` | **查过，不是空位** —— 见下 |
| `/merge-pdf/` | **查过，不是空位** —— 见下 |
| `/screenshot/` 工具页 | 未排期 |
| 外部作者渠道（vizua.io / orthogonal.info） | 已量过外链；2026-10-04 晚重跑 `vet-writer-targets.cjs` 仍 15 外链 / 0 blocking；**邮件发不出去：Agent 邮箱未开通**，草稿已在 `promo/writer-outreach-2026-10-04.md` 里等着 |
| 两周后回看 v74–v77 补的语言有没有换来曝光 | 未到时间 |
| 去背 AI 模式（u2netp 懒加载） | 依赖未就位 |

### PDF 第二刀：两个候选都不是空位（2026-10-04 查证）

v81 待办里写的是「`/pdf-to-jpg/` 或 `/merge-pdf/`，先确认哪个还空」。两条都查了：

- **`/pdf-to-jpg/`** —— 5 个专门的浏览器端无上传工具已经排满：`pdftoimage.app`、
  `offpdf.com`、`trulyfreepdf.com`、`freeconverto.com`、`freeconverter.app`，全部用 PDF.js
  渲染 + canvas 导出 + JSZip 打包，功能高度同一（页范围、DPI 72/144/216、ZIP 下载）。
  **没有空位。**
- **`/merge-pdf/`** —— 同样 5 个：`merge-papers.com`、`digitaltoolpad.com`、`technosuffice.com`、
  `pdfguru.online`、`utildaily.com`，全部 pdf-lib 复制页面对象 + 拖拽排序 + 无水印 + 不限数量。
  **没有空位。**

两边都只剩「同样的功能，另一层包装」，那不是差异化。

**唯一还站得住的角度**：`merge-pdf` 那几家全都在说「lossless merge —— 原样拷贝，不重渲染」，
没人回答「合并完我还是要发给别人，文件比我拖进去的还大怎么办」——
这是我们 `/compress-pdf/` 已经能回答的问题。所以真要动，是**合并 + 重编码一遍**
（`/merge-and-shrink-pdf/` 或者做成 `/merge-pdf/` 页里的一个开关），
开工前先量一个东西：三份 PDF 合并成一份、且不重编码的体积，vs 合并后顺手重编码一次的体积，
差多少、掉多少 dB。量出来是零才停手。**别先写代码。**

---

## 七、维护纪律（下一个人照着做）

1. **同口径**：同一个数据页只留一套测量方法和一套数字；两套互相打架的数字比缺数据更糟。
2. **别写死 endpoint**：iLoveIMG 的上传域名 9 月是 api10、10 月是 api22，写进文案几周就过期。
3. **探测失败 ≠ 目标真的如此**：本仓库出网会被切片（v78 那次 github.com 也一起 `code=000`），
   只记「未验证」，不写「已死」。
4. **改完可见 FAQ 正文 → 再跑 `sync-faq-schema.py` → 再回归**，反序会被 test-pages 挂住。
5. **新页 8 处同步**：sitemap、页脚/导航（首页与子目录两种变体）、`sw.js` SHELL、
   `test-pages.cjs`、`llms.txt`、`sync-faq-schema.py` PAGES、`test-engine.cjs` appPages、正文内链防孤儿。

---
name: release
description: "Guide a full version release of the simple-sftp VS Code extension. Use when: releasing a new version, bumping version number, tagging a release, publishing to marketplace, creating a GitHub release, writing changelog, or running the release workflow."
argument-hint: "（可选）要发布的版本号，例如 6.2.0。若不提供，则自动根据 CHANGELOG.md 和新增功能推断"
---

# 发布 — simple-sftp VS Code 扩展

完整发布流程：自动推断版本号 → 更新日志 → 提交 → 打 Tag → CI/CD 自动发布。

## 前置条件

- [ ] 仓库 Settings → Secrets → Actions 中已配置 `VSCE_PAT`
- [ ] 所有功能分支已合并到 `main`
- [ ] 本地 `main` 已是最新（`git pull`）

---

## 第一步 — 确定版本号

### 若调用时已提供版本号参数

直接使用该参数作为新版本号，跳过自动推断。

### 若调用时未提供版本号参数（自动推断）

**1. 读取当前版本**：从 `package.json` → `"version"` 字段获取当前版本号（格式 `x.y.z`）。

**2. 分析 `git diff`**：执行以下命令，获取自上次 tag 以来的所有提交变更内容：

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

同时读取 `CHANGELOG.md` 顶部未发布的条目（若存在），以及当前工作区中已修改但尚未提交的文件列表（`git status`）。

**3. 按以下规则推断递增位**：

| 信号 | 递增位 | 说明 |
|---|---|---|
| 提交信息含 `BREAKING CHANGE` 或 `!:` | **major** `X.0.0` | 破坏性变更 |
| 提交信息含 `feat:` / `feature:` 或改动属于新功能（新命令、新配置项、新 UI） | **minor** `x.Y.0` | 新功能（向后兼容） |
| 提交信息含 `fix:` / `chore:` / `refactor:` / `docs:` / `style:` / `perf:` 或仅为 bug 修复、微调、优化 | **patch** `x.y.Z` | 修复 / 微调 |

当同一次发布同时包含多种类型时，取优先级最高的（major > minor > patch）。

**4. 推断后向用户展示**：告知推断出的版本号及理由，例如：
> 当前版本 `6.7.5`，检测到新功能（Export SSH Config 命令增强），推断为 **minor** 升级 → 新版本 `6.8.0`。

若推断结果不符合预期，用户可在此时提供覆盖值。

遵循[语义化版本](https://semver.org/lang/zh-CN/)规则：

| 变更类型 | 递增位 | 示例 |
|---|---|---|
| Bug 修复 / 微调 | **patch** `x.y.Z` | 6.1.5 → 6.1.6 |
| 新功能（向后兼容） | **minor** `x.Y.0` | 6.1.5 → 6.2.0 |
| 破坏性变更 | **major** `X.0.0` | 6.1.5 → 7.0.0 |

---

## 第二步 — 修改 `package.json` 并同步 `package-lock.json`

将 `"version"` 改为新版本号：

```json
"version": "<新版本号>",
```

然后运行以下命令，让 `package-lock.json` 中的版本号与 `package.json` 保持一致（不会安装或升级任何依赖）：

```bash
npm install --package-lock-only
```

> **为什么需要这一步？**
> `package-lock.json` 顶部也记录了 `"version"` 字段。若两者不一致，CI 中的 `npm ci` 可能警告或行为异常，且 `vsce package` 打包后扩展信息也会不匹配。

在提交时，将 `package-lock.json` 一并纳入：

```bash
git add package.json package-lock.json CHANGELOG.md
```

---

## 第三步 — 更新 `CHANGELOG.md`

在文件顶部（`# Change Log` 下方）新增一节，保持现有风格：

```markdown
## <新版本号> - YYYY-MM-DD

- **Feature/Fix/Enhancement**: 简短描述本次变更。
```

每条描述保持一行，简洁为主。

---

## 第四步 — 本地跑测试（推荐）

```bash
npm run test:unit
```

有失败请先修复再继续。

---

## 第五步 — 提交版本变更

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v<新版本号>"
```

---

## 第六步 — 打 Tag 并推送（触发 CI/CD）

```bash
git tag v<新版本号>
git push origin main --tags
```

推送 tag 后，GitHub Actions 的 **Release** workflow 将自动运行：单元测试 → 打包 → 发布到 Marketplace → 创建 GitHub Release。

---

## 第七步 — 确认 CI/CD 结果

1. 打开 **GitHub → Actions → Release**，确认所有步骤通过
2. 检查 [VS Code Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=WangBowen.simple-sftp)，确认新版本已上线

---

## 手动触发（无需重新打 Tag）

需要对已有版本重跑流程时：

1. GitHub → Actions → Release → **Run workflow**
2. 输入版本号（必须与 `package.json` 中一致）

---

## 常见问题排查

| 问题 | 解决方法 |
|---|---|
| `VSCE_PAT` 已过期 | 在 [Azure DevOps](https://dev.azure.com/) 生成新 PAT（权限选 **Marketplace → Manage**），更新 GitHub Secret |
| Tag 已存在 | `git tag -d v<版本> && git push origin :refs/tags/v<版本>`，再重新打 tag |
| CI 测试失败 | 本地执行 `npm run test:unit`，修复后 amend commit，再 force-push tag |
| 版本号不匹配 | 确保 `package.json` 中的版本与 tag 名称去掉 `v` 前缀后完全一致 |

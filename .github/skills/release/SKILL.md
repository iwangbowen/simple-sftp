---
name: release
description: "Guide a full version release of the simple-sftp VS Code extension. Use when: releasing a new version, bumping version number, tagging a release, publishing to marketplace, creating a GitHub release, writing changelog, or running the release workflow."
argument-hint: "要发布的版本号，例如 6.2.0"
---

# 发布 — simple-sftp VS Code 扩展

完整发布流程：更新版本号 → 更新日志 → 提交 → 打 Tag → CI/CD 自动发布。

## 前置条件

- [ ] 仓库 Settings → Secrets → Actions 中已配置 `VSCE_PAT`
- [ ] 所有功能分支已合并到 `main`
- [ ] 本地 `main` 已是最新（`git pull`）

---

## 第一步 — 确定版本号

遵循[语义化版本](https://semver.org/lang/zh-CN/)规则：

| 变更类型 | 递增位 | 示例 |
|---|---|---|
| Bug 修复 / 微调 | **patch** `x.y.Z` | 6.1.5 → 6.1.6 |
| 新功能（向后兼容） | **minor** `x.Y.0` | 6.1.5 → 6.2.0 |
| 破坏性变更 | **major** `X.0.0` | 6.1.5 → 7.0.0 |

当前版本号在 `package.json` → `"version"` 字段。

---

## 第二步 — 修改 `package.json`

将 `"version"` 改为新版本号：

```json
"version": "<新版本号>",
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
git add package.json CHANGELOG.md
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

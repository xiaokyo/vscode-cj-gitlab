# CJ gitlab 私服快速合并和发布测试

## 功能特点

- 支持 CJ 项目一键发布到测试环境
- 支持私服项目一键合并到 cn 和 com环境
- 自动识别测试环境是 dev 还是 master， cn 环境是 master-cn 还是 cn， com 环境是 release 还是 master
- 复制合并链接带上项目的信息。例：项目名称、最后一条commit信息、合并环境
- 简化发布流程，提高工作效率

## 安装

点击下面链接安装
https://marketplace.cursorapi.com/items?itemName=xiaokyo.cj-gitlab

或者在vscode的插件市场中搜索````CJ GitLab````

## 使用方法

### 基础配置

在 vscode 配置如下

```json
"cj-gitlab.apiUrl": "http://192.168.5.143:1180",
"cj-gitlab.token": "xxxxxx"
```

获取 gitlab token页面

http://192.168.5.143:1180/profile/personal_access_tokens

### 分支映射配置（可选）

如果项目的环境分支与默认规则不符，可以通过 `branchMapping` 配置自定义各环境的目标分支。

**默认行为：**
- **测试环境（test）**：优先查找 `release` 分支，有则合并到 `master`，否则合并到 `dev`
- **CN 线上环境（cn）**：优先查找 `master-cn` 分支，有则合并到 `master-cn`，否则合并到 `cn`
- **COM 线上环境（com）**：优先查找 `release` 分支，有则合并到 `release`，否则合并到 `master`

**自定义配置示例：**

```json
"cj-gitlab.branchMapping": {
  "project-a": {
    "test": "master",
    "cn": "master-cn",
    "com": "release"
  },
  "project-b": {
    "test": "dev-test"
  }
}
```

- 已配置的项目和环境按配置值优先级执行
- 未配置或未指定环境的项目自动走默认逻辑

## 贡献指南

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT

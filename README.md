# CJ gitlab 私服快速合并和发布测试

## 功能特点

- 支持 CJ 项目一键发布到测试环境
- 支持私服项目一键合并到 cn 和 master
- 自动识别测试环境是 dev 还是 master， cn 环境是 master-cn 还是 cn， com 环境是 release 还是 master
- 简化发布流程，提高工作效率

## 使用方法

在 vscode 配置如下

```
"cj-gitlab.apiUrl": "http://192.168.5.143:1180",
"cj-gitlab.token": "xxxxxx"
```

获取 gitlab token页面

http://192.168.5.143:1180/profile/personal_access_tokens

## 贡献指南

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT

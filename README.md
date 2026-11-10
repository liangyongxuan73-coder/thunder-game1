# 雷霆战线（网页游戏）

这是可部署到 Vercel 的网页游戏项目。部署后，任何人都可以通过公开网址在手机或电脑浏览器中打开游玩。

## 部署到 Vercel

1. 将本文件夹中的全部文件上传到一个新的 GitHub 仓库（不要只上传 ZIP 文件本身）。
2. 登录 https://vercel.com/ 并使用 GitHub 登录。
3. 选择 **Add New → Project**，导入刚创建的 GitHub 仓库。
4. Framework Preset 选择 **Other**（如果自动识别为 Vite，也可以保留自动识别）。
5. Install Command 和 Build Command 使用项目 `vercel.json` 中的配置；无需填写环境变量。
6. 点击 **Deploy**。完成后 Vercel 会生成一个 `*.vercel.app` 公网链接，复制分享即可。

## 说明

- 项目已将 `VITE_AUTH_ENABLED` 设为 `false`，访客无需注册登录。
- 当前项目未启用外部数据库；构建脚本会在没有 `DATABASE_URL` 时自动跳过数据库迁移。
- 不要把任何个人密钥或账号密码写进仓库。

# DataZen 安装说明

## 首次打开前，请先执行一条命令

DataZen 尚未通过 Apple 公证（notarization）。从 DMG 拖进「应用程序」后，
macOS 的 Gatekeeper 会因为这个未签名来源而拒绝打开，提示"应用已损坏"
或"无法验证开发者"。**这不是应用真的坏了**，而是 Gatekeeper 对未公证
应用的常规拦截。

首次打开前，请在「终端」里执行：

```bash
xattr -cr /Applications/DataZen.app
```

这条命令会清除应用包上 Apple 的隔离属性（quarantine flag）——那个属性
是 Gatekeeper 据以拦截的依据，也是上面报错的原因。清除之后就可以正常
双击打开，无需再做任何其他设置。

执行前请确认应用确实已经拖入 `/Applications`，路径写错不会有效果。

> 提示：如果你是在浏览器里下载的 DMG，可以先对 DMG 本身执行
> `xattr -cr ~/Downloads/DataZen-*.dmg`，再打开、拖拽。

## 关于代码签名

后续版本会逐步推进 Apple Developer ID 签名与公证。一旦完成公证，本页
说明即可忽略，届时双击打开不会再有任何拦截提示。

## 校验安装包完整性

发布页提供了每个安装包的 SHA256 校验值，可以自行核对：

```bash
shasum -a 256 -c <checksums 文件>
```

## 卸载

将 `/Applications/DataZen.app` 拖入废纸篓即可。连接配置与本地数据保存在
`~/Library/Application Support/DataZen/`，如需彻底清理请一并删除该目录。

# 固定应急运行时

`lock.json` 与正式 DSH 依赖锁独立。构建仅接收锁中精确 SHA-256 的归档；初次构建可从字节相同的正式资产建立本地 `archives/`。正式 DSH 升级后，必须继续提供已锁定的应急归档，不能自动改锁或拿新归档冒充。

归档与其他离线资产一样不提交 Git。历史 APK 可从 `assets/recovery-rootfs.bin` 和 `assets/recovery-dsh-runtime.bin` 提取到 `archives/`。去重后的 APK 根据 `assets/recovery-asset-locations.json` 的 `source` 读取包内文件，保存为对应 `asset` 逻辑名；用 `recovery_apk_assets.archive_locations` 先核对映射及实际摘要。构建仍重新核对独立锁。仅在应急运行时完成独立启动、能力限制、网页与停止验收后才允许更新锁。

`prepare-recovery-assets.py` 在生成目录写入独立描述及逐文件证明；它不会改动正式运行时描述，也不会将主运行时的版本号推导为应急版本。

应急与正式归档的 SHA-256 完全相同时，APK 只存一份字节，通过独立存储映射引用。解压后的根、数据、锁、身份及启动流程仍独立；不读取正式环境的已解压目录。正式版本以后变化时，构建自动重新打包旧的固定应急归档，不会跟随升级。映射不参与内容 runtimeId，因此已验收的应急舱不因去重而重建。

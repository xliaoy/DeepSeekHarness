// 无限五代 · 工具链数据（单一真源）
//
// 为什么单独成文件：领域包讲「怎么打」，这份讲「用什么打、本地没有时怎么装、装完怎么验」。
// 二者生命周期不同——领域包随知识更新，工具链随发行版/生态变化。
//
// 每行格式（渲染时原样进 playbook 的「工具链」一节）：
//   <工具> — <用途> | 装: <安装命令> | 验: <验证命令>
// 约定：
//   - 安装命令给最优先的一条；替代路径写在同一行的括号里，不要铺开成多行。
//   - 验证命令必须是「跑一下就有输出」的，方便模型把结果粘进正文当证据。
//   - 版本敏感的工具（frida、内核模块）必须写明「版本要对齐」，这是最常见的坑。
//
// TOOLCHAIN_PROTOCOL 会被内核载荷的「工具链规则」概括，并被领域工具原样返回。

export const TOOLCHAIN_DATA_VERSION = 1;

// 本地缺工具时的通用协议：探测 → 安装 → 验证 → 降级 → 记录。
export const TOOLCHAIN_PROTOCOL = [
  "先探测再装：command -v <tool> || <tool> --version；在 PATH 里就直接用，不要重装。",
  "装一次，按优先级挑一条：系统包管理（apt/apk/brew）→ pipx（Python CLI 首选）/ python3 -m pip install --user → go install <module>@latest → cargo install → 官方静态包（curl -fsSL <URL> -o /tmp/t.tgz && tar -xzf /tmp/t.tgz -C /opt）→ 容器（docker run --rm -it <image>）。",
  "装完必须验证：跑一次 --version / --help，把版本行写进正文；没装上就报错，不要假定成功。",
  "无网、无 root 或装不上：给出等价替代（系统自带命令、容器、手写脚本），并明确写出降级点——不要停在「请自行安装」。",
  "每条命令配预期输出与失败分支：报错 X → 试 Y（换镜像源、换静态包、换容器）。",
  "侵入性工具（内核模块、驱动、刷机、硬件写）先给隔离建议（虚拟机 / 独立设备 / 可回滚快照），再给命令。",
  "把「装了什么、版本多少、哪一步降级了」写进交付物末尾，别让读者猜你的环境。",
];

export const TOOLCHAINS = {
  // ───────────────────────── offense ─────────────────────────
  web: [
    "ffuf — 目录/参数爆破 | 装: go install github.com/ffuf/ffuf/v2@latest（或 apt install ffuf）| 验: ffuf -V",
    "feroxbuster / gobuster — 递归目录与备份文件 | 装: apt install feroxbuster（或 go install github.com/epi052/feroxbuster@latest）| 验: feroxbuster --version",
    "nuclei — 已知漏洞批量验证 | 装: go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest，然后 nuclei -update-templates | 验: nuclei -version",
    "httpx / katana — 存活指纹与爬取 | 装: go install github.com/projectdiscovery/httpx/cmd/httpx@latest | 验: httpx -version",
    "sqlmap — 注入验证 | 装: pipx install sqlmap（或 python3 sqlmap.py 直跑）| 验: sqlmap --version",
    "mitmproxy / Caido / Burp CE — 抓改包 | 装: pipx install mitmproxy；替代: docker run --rm -it mitmproxy/mitmproxy | 验: mitmproxy --version",
    "jq / yq — 响应体结构化对比 | 装: apt install jq（yq 用官方 release）| 验: jq --version",
    "都装不上：curl + python3 -c 手写枚举与差分；把并发、节流、代理池自己实现，写进正文而不是省略",
  ],
  mobile: [
    "apktool — 资源与 smali 解包/回编 | 装: apt install apktool（或官方 jar + wrapper）| 验: apktool --version",
    "jadx / jadx-gui — DEX→Java 反编译 | 装: 官方 release zip；替代: apt install jadx | 验: jadx --version",
    "frida + frida-tools — 运行时 Hook | 装: pipx install frida-tools；**frida-server 必须与 frida 版本严格一致** | 验: frida --version 与 frida-server --version 相同",
    "objection — 免 root 常见绕过 | 装: pipx install objection | 验: objection version",
    "adb + platform-tools — 设备通道 | 装: apt install android-tools-adb（或 platform-tools zip）| 验: adb version",
    "MobSF — 一体化静态/动态报告 | 装: docker run --rm -it -p 8000:8000 opensecurity/mobile-security-framework-mobsf | 验: 打开 127.0.0.1:8000",
    "无 root 设备：优先「Frida gadget 重打包 + 自有签名」或「静态结论 + 官方模拟器复验」两条路，写清选哪条",
  ],
  miniprogram: [
    "wxappUnpacker / unveilr — wxapkg 解包 | 装: git clone + npm i | 验: node wuWxapkg.js -h",
    "node + pnpm/npm — 还原后的依赖与脚本 | 装: 官方 nvm 脚本安装 node，npm i -g pnpm | 验: node -v && pnpm -v",
    "mitmproxy / Charles — 请求拦截 | 装: pipx install mitmproxy | 验: mitmproxy --version",
    "asar / @electron/asar — 跨端包解包 | 装: npm i -g @electron/asar | 验: asar --version",
    "证书固定时：Frida hook 校验函数或改包重签（自有包），不要做中间人绕过第三方 App 的防护",
  ],
  game: [
    "Cheat Engine — 内存扫描与指针链 | 装: 官方安装包（Windows）| 验: 关于页看版本",
    "x64dbg — 用户态调试与断点 | 装: 官方 release 快照 | 验: 打开后 about",
    "Ghidra / IDA Free — 静态定位 IL2CPP 函数 | 装: apt install ghidra（或 zip）| 验: ghidraRun -version",
    "Il2CppDumper + Unity 元数据 — 还原类/方法名 | 装: 官方 release（需 global-metadata.dat + 二进制）| 验: 生成 dump.cs 非空",
    "ReClass.NET — 重建结构体 | 装: 官方 release | 验: 附加目标进程成功",
    "Frida — 运行时验证偏移 | 装: pipx install frida-tools | 验: frida --version",
    "只做离线单机：联网对战与反作弊绕过不在本域，别把两件事写进同一份交付",
  ],
  kernel: [
    "gdb + pwndbg/gef — 内核/驱动调试 | 装: apt install gdb；pwndbg 用 git clone + ./setup.sh | 验: gdb -q -ex 'pi print(1)'",
    "QEMU — 可回滚的测试环境（首选隔离手段） | 装: apt install qemu-system-x86 qemu-user-static | 验: qemu-system-x86_64 --version",
    "buildroot / busybox — 最小根文件系统 | 装: apt install busybox-static；buildroot 用官方 release | 验: busybox | head -1",
    "strace / ltrace / perf — 系统调用与性能观测 | 装: apt install strace ltrace linux-perf | 验: strace -V",
    "bpftrace / bcc — eBPF 观测与拦截 | 装: apt install bpftrace bpfcc-tools | 验: bpftrace --version",
    "drgn / crash — 活体与转储分析 | 装: pipx install drgn；crash 走 apt install crash | 验: drgn --version",
    "内核模块必须在虚拟机或专用设备里加载；宿主上只做编译与静态分析",
  ],
  firmware: [
    "binwalk / unblob — 固件切开与提取 | 装: pipx install binwalk（unblob: pipx install unblob）| 验: binwalk --version",
    "sasquatch — 魔改 squashfs 提取 | 装: 源码 make（无网时用 unsquashfs 先试）| 验: sasquatch | head -1",
    "ubi_reader / jefferson — UBI/JFFS2 文件系统 | 装: pipx install ubi_reader jefferson | 验: ubireader_extract_images -h",
    "strings / hexdump — 无 xxd 环境下的二进制速读 | 装: 系统自带 binutils/util-linux | 验: hexdump -C FW.bin | head",
    "Ghidra + 架构后端 — 定位固件服务 | 装: apt install ghidra；交叉架构用 qemu-user-static 跑 | 验: qemu-mipsel-static -version",
    "flashrom — 读取/写入闪存（硬件） | 装: apt install flashrom | 验: flashrom -L | head（写操作前先 dump 备份）",
    "刷写与写保护一律先备份镜像并核对校验和；不能回滚的操作只在一次性设备上做",
  ],
  rf: [
    "rtl-sdr + rtl_433 — 433/868MHz 接收解码 | 装: apt install rtl-sdr rtl-433 | 验: rtl_test -t",
    "GNU Radio + gr-limesdr/gr-osmosdr — 信号处理链 | 装: apt install gnuradio gr-osmosdr | 验: gnuradio-config-info --version",
    "hackrf / bladeRF 工具 — 收发与回放 | 装: apt install hackrf | 验: hackrf_info",
    "proxmark3 — 125k/13.56MHz 卡模拟与嗅探 | 装: 源码 make（官方 repo）| 验: pm3 --version",
    "libnfc + mfoc / mfcuk — 门禁卡分析 | 装: apt install libnfc-bin mfoc | 验: nfc-list",
    "Universal Radio Hacker (urh) — 波形解调与协议还原 | 装: pipx install urh | 验: urh --version",
    "只在自己持有或书面授权的设备与频段上发射；接收默认被动、不干扰在用系统",
  ],
  automotive: [
    "can-utils — SocketCAN 收发与嗅探 | 装: apt install can-utils | 验: candump -h",
    "python-can + cantools — 脚本化分析与 DBC 解析 | 装: pipx install python-can cantools | 验: python3 -c 'import can,cantools'",
    "ICSim — 虚拟仪表台做安全练习 | 装: 源码 make（自带 vcan 脚本）| 验: ./icsim vcan0",
    "SavvyCAN / Wireshark — 报文可视化 | 装: SavvyCAN 官方 release；Wireshark: apt install wireshark | 验: wireshark --version",
    "caringcaribou — 车机服务与 UDS 探测 | 装: pipx install caringcaribou | 验: cc.py -h",
    "CANoe/CANalyzer 属商业授权；没有就明说用开源替代，别写假命令",
    "在车辆上只做读操作；写报文、刷 ECU 一律用台架或离线模拟",
  ],
  cloud: [
    "kubectl + kubeconfig — 集群操作 | 装: 官方 curl 安装脚本 | 验: kubectl version --client",
    "trivy / grype — 镜像与配置扫描 | 装: 官方 install.sh（或 apt install trivy）| 验: trivy --version",
    "kube-hunter / kubesec — 集群姿态与配置审计 | 装: pipx install kube-hunter kubesec | 验: kube-hunter --help",
    "crane / skopeo — 镜像层拉取与改写 | 装: go install github.com/google/go-containerregistry/cmd/crane@latest | 验: crane version",
    "etcdctl — 直接读 secrets（有权限时） | 装: 官方 release | 验: etcdctl version",
    "awscli + pacu / azure-cli — 云 API 枚举与权限链 | 装: pipx install awscli pacu（azure-cli 用官方脚本）| 验: aws --version && az version",
    "云上操作先确认租户与账号归属；破坏性动作前先导出快照或证据",
  ],
  network: [
    "impacket — SMB/Kerberos/LDAP 协议套件 | 装: pipx install impacket | 验: python3 -c 'import impacket,impacket.examples'",
    "netexec (nxc) / crackmapexec — 批量横向验证 | 装: pipx install netexec | 验: nxc --version",
    "BloodHound + SharpHound/bloodhound-python — 域内关系图 | 装: pipx install bloodhound（CE 用官方 release）| 验: bloodhound-python -h",
    "Responder / mitm6 — 名称解析投毒演示 | 装: pipx install responder（mitm6: pipx install mitm6）| 验: responder -h",
    "kerbrute / certipy-ad — Kerberos 与 ADCS 攻击面 | 装: go install github.com/ropnop/kerbrute@latest；pipx install certipy-ad | 验: kerbrute -h",
    "nmap + ldapdomaindump — 探测与目录导出 | 装: apt install nmap；pipx install ldapdomaindump | 验: nmap --version",
    "每条横向动作都写清凭据来源与授权范围；能只读验证就不要落地写操作",
  ],
  network_device: [
    "nmap + NSE — 设备与服务探测 | 装: apt install nmap | 验: nmap --version",
    "snmpwalk / snmp-mibs-downloader — SNMP 枚举 | 装: apt install snmp snmp-mibs-downloader | 验: snmpwalk -V",
    "tcpdump / tshark — 抓包与协议还原 | 装: apt install tcpdump tshark | 验: tshark --version",
    "nc / telnet / ssh — 管理面接入 | 装: apt install netcat-openbsd openssh-client | 验: nc -h",
    "hydra / medusa — 弱口令验证（自有设备） | 装: apt install hydra | 验: hydra -h",
    "netmiko / napalm — 配置批量读取 | 装: pipx install netmiko napalm | 验: python3 -c 'import netmiko'",
    "GNS3 / EVE-NG — 无设备的实验拓扑 | 装: 官方安装（或 docker 镜像）| 验: 打开 web 控制台",
    "改配置前先 copy running-config 存证；生产链路只读不写",
  ],
  supply_chain: [
    "syft — 生成 SBOM | 装: 官方 install.sh（或 go install github.com/anchore/syft/cmd/syft@latest）| 验: syft --version",
    "grype / trivy — 依赖漏洞匹配 | 装: 官方 install.sh（trivy 同前）| 验: grype --version",
    "osv-scanner — OSV 库比对（含锁文件） | 装: go install github.com/google/osv-scanner/cmd/osv-scanner@latest | 验: osv-scanner --version",
    "pip-audit / npm audit / cargo audit — 生态原生审计 | 装: pipx install pip-audit；npm i -g 的包自带 audit | 验: pip-audit --version",
    "cosign / slsa-verifier — 制品签名与来源校验 | 装: go install github.com/sigstore/cosign/v2/cmd/cosign@latest | 验: cosign version",
    "CI 配置读取：直接读 .github/workflows、Jenkinsfile、Dockerfile，把可疑步骤标出来（不需要装工具）",
    "结论必须落到「哪个包、哪版、哪个 CVE/规则、怎么修」，不要只给扫描器的整体评分",
  ],
  osint: [
    "theHarvester — 域名与邮箱采集 | 装: pipx install theHarvester | 验: theHarvester -h",
    "sherlock / maigret / holehe — 账号跨站关联 | 装: pipx install sherlock-project maigret holehe | 验: sherlock --version",
    "exiftool — 元数据提取（图片/文档） | 装: apt install libimage-exiftool-perl | 验: exiftool -ver",
    "recon-ng / spiderfoot — 编排式采集 | 装: pipx install recon-ng spiderfoot | 验: recon-ng -h",
    "gowitness / playwright — 批量截图留证 | 装: go install github.com/sensepost/gowitness@latest；pipx install playwright && playwright install chromium | 验: gowitness version",
    "Maltego CE — 关系图可视化 | 装: 官方安装包 + 免费账号 | 验: 新建 graph 可加载 transform",
    "只采集公开信息；个人身份关联必须落在授权调查范围内，正文里写明范围",
  ],
  crack: [
    "Ghidra / IDA Free — 定位校验逻辑 | 装: apt install ghidra | 验: ghidraRun -version",
    "dnSpy / ILSpy — .NET 反编译与调试 | 装: 官方 release（Windows）| 验: 打开目标程序集",
    "x64dbg + ScyllaHide — 反反调后动态跟进 | 装: 官方 release + 插件 | 验: 插件面板显示 ScyllaHide",
    "Frida — 运行时改返回值验证结论 | 装: pipx install frida-tools | 验: frida --version",
    "unipacker — 自动脱壳（配合本域与 unpack 域） | 装: pipx install unipacker | 验: unipacker --help",
    "hashcat / john — 授权范围内的口令强度审计 | 装: apt install hashcat john | 验: hashcat --version",
    "只对自有或授权软件做分析；注册机/授权绕过的产出以「修复建议 + 校验设计缺陷」为主要形态",
  ],
  re: [
    "Ghidra — 反编译 + 反汇编 + 脚本化分析 | 装: apt install ghidra（无网用官方 zip: unzip ghidra_*.zip）| 验: ghidraRun -version 或 analyzeHeadless 无参输出用法",
    "rizin + Cutter / radare2 — CLI 与图形逆向 | 装: 官方 release（或 apt install rizin cutter）| 验: rizin -v",
    "binutils（readelf/objdump/strings/nm）— 格式与节区速查 | 装: 系统自带，缺则 apt install binutils | 验: readelf -h BIN | head",
    "gdb + pwndbg/gef — 动态调试与内存布局 | 装: apt install gdb；pwndbg: git clone https://github.com/pwndbg/pwndbg && ./setup.sh | 验: gdb -q -ex 'pi print(1)'",
    "x64dbg（Windows）/ lldb（macOS）— 平台原生调试器 | 装: 官方 release / xcode-select --install | 验: lldb --version",
    "capstone / keystone / pyelftools / LIEF — 脚本化解析与改写 | 装: pipx install capstone keystone-engine pyelftools lief | 验: python3 -c 'import capstone,keystone,lief'",
    "angr — 符号执行辅助还原 | 装: pipx install angr | 验: python3 -c 'import angr,claripy'",
    "Detect It Easy (diec) — 编译器/壳/架构指纹 | 装: 官方 release zip | 验: diec --version",
  ],
  unpack: [
    "Detect It Easy (diec) — 先判壳再动手 | 装: 官方 release zip | 验: diec --version",
    "upx -d — UPX 直接解压 | 装: apt install upx-ucl | 验: upx -V",
    "unipacker — 自动脱壳与导入表重建 | 装: pipx install unipacker | 验: unipacker --help",
    "x64dbg + Scylla — 运行时 dump + IAT 修复 | 装: 官方 release + Scylla 插件 | 验: 插件加载并识别目标 OEP",
    "Frida — 内存段 dump（对付只在运行时解密的壳） | 装: pipx install frida-tools | 验: frida --version",
    "PE-bear / CFF Explorer — 节区与头字段对比 | 装: 官方 release | 验: 打开原文件与 dump 对比节表",
    "顺序固定：指纹 → 入口点/节区特征 → 静态解压 → 运行时 dump → IAT 修复 → 复验可执行；跳步会白干",
  ],
  obfuscation: [
    "de4dot / dnSpy / ILSpy — .NET 反混淆与反编译 | 装: 官方 release | 验: de4dot --help",
    "prettier / clang-format / js-beautify — 先恢复版式再看控制流 | 装: npm i -g prettier；pipx install jsbeautifier；apt install clang-format | 验: prettier --version",
    "javascript-obfuscator 生态的反向工具（synchrony / deobfuscator / AST 脚本） | 装: npm i -g 或 git clone + npm i（Babel AST 手写脚本最稳） | 验: 还原后变量名可读、字符串已解密",
    "YARA — 用规则确认混淆家族与常量特征 | 装: apt install yara | 验: yara --version",
    "angr / miasm — 常量折叠与控制流平坦化还原 | 装: pipx install angr miasm | 验: python3 -c 'import angr,miasm'",
    "CyberChef — 字符串解密快速试（base64/XOR/RC4 链） | 装: docker run --rm -p 8080:80 mpepping/cyberchef | 验: 浏览器打开 127.0.0.1:8080",
    "先分类再动手：标识符混淆、字符串加密、控制流平坦化、虚拟机保护——四类的解法完全不同，正文里要点名遇到的是哪一类",
  ],
  hook_inject: [
    "Frida — 跨平台函数级 Hook（首选） | 装: pipx install frida-tools；目标侧 frida-server 版本必须与 frida 完全一致 | 验: frida --version 与 frida-server --version 相同",
    "MinHook / Microsoft Detours — Windows API Hook 与 IAT/EAT 改写 | 装: vcpkg install minhook（Detours 用源码）| 验: 编译官方 sample 成功",
    "LD_PRELOAD / ptrace — Linux 用户态拦截 | 装: 系统自带 gcc + libc | 验: gcc --version && ldd --version | head -1",
    "bpftrace / bcc — 内核层观测与拦截 | 装: apt install bpftrace bpfcc-tools | 验: bpftrace --version",
    "x64dbg + ScyllaHide — 反反调后再注入调试 | 装: 官方 release + 插件 | 验: 插件面板可见",
    "顺序：先确认符号与调用约定 → 再选 hook 点（导入表/函数头/vtable）→ 写最小可回滚脚本 → 验证返回值改变 → 再谈持久化",
  ],
  malware: [
    "YARA — 家族与常量规则匹配 | 装: apt install yara（或 pipx install yara-python）| 验: yara --version",
    "capa — 能力识别与 ATT&CK 映射 | 装: pipx install flare-capa（或官方 release）| 验: capa -v",
    "Volatility3 — 内存镜像取证 | 装: pipx install volatility3 | 验: vol -h",
    "PE-sieve / hollows_hunter — 进程内存马与注入检测 | 装: 官方 release | 验: 跑一次看输出报告",
    "CAPE / Cuckoo — 隔离沙箱动态行为 | 装: docker run --rm -it capesandbox（或官方 compose）| 验: 打开面板端口",
    "FLARE-VM / REMnux — 分析虚拟机（首选运行环境） | 装: 官方安装脚本 | 验: 虚拟机快照可回滚",
    "静态三件套：strings + binwalk + diec；动态全在快照虚拟机里跑，样本永不落宿主；IOC 要给可机读格式（hash/域名/正则）",
  ],
  exploit_dev: [
    "pwntools — 利用脚本与 ELF 交互 | 装: pipx install pwntools | 验: python3 -c 'import pwn; print(pwn.version)'",
    "ROPgadget / ropper / one_gadget — gadget 与约束搜索 | 装: pipx install ROPgadget ropper one_gadget | 验: ROPgadget --version",
    "patchelf / LIEF — 改 ELF 依赖与节区（调试用） | 装: apt install patchelf；pipx install lief | 验: patchelf --version",
    "checksec + gdb + pwndbg/gef — 缓解措施与崩溃现场 | 装: pwntools 自带 checksec；pwndbg 见 re 域 | 验: pwn checksec BIN",
    "mingw-w64 / nasm / clang — 交叉编译与 shellcode 汇编 | 装: apt install mingw-w64 nasm clang | 验: x86_64-w64-mingw32-gcc --version",
    "ASAN/UBSAN — 用 sanitizer 把内存错误变成可读报告 | 装: clang -fsanitize=address,undefined | 验: 编译最小样例并触发一次崩溃",
    "msfvenom（授权演练）| 装: apt install metasploit-framework | 验: msfvenom --version",
    "交付要含：偏移推导过程、环境指纹（libc/build id）、成功率与失败条件；只在授权靶机或自家环境执行",
  ],
  fuzzing: [
    "AFL++ — 覆盖率引导 fuzz（含 QEMU 模式跑闭源目标） | 装: apt install afl++（或源码 make）| 验: afl-fuzz -h | head -3",
    "libFuzzer / honggfuzz — 进程内 fuzz harness | 装: clang -fsanitize=fuzzer；apt install honggfuzz | 验: clang --version",
    "boofuzz / peach — 网络协议 fuzz | 装: pipx install boofuzz | 验: python3 -c 'import boofuzz'",
    "syzkaller — 内核系统调用 fuzz | 装: go install + 官方镜像 | 验: syz-manager -h",
    "Grammarinator / Nautilus — 带语法的结构化 fuzz | 装: pipx install grammarinator | 验: grammarinator-fuzz -h",
    "三分类脚本：ASAN 报告 / gdb bt / exploitable 判定——先写 triage，再扩语料，否则崩溃堆成山没人看",
    "报告格式：种子来源、覆盖率增长、唯一崩溃数（去重后的 hash）、每个崩溃的最小复现输入",
  ],

  // ───────────────────────── crypto ─────────────────────────
  protocol_re: [
    "tcpdump / tshark — 抓包与字段提取 | 装: apt install tcpdump tshark | 验: tshark --version",
    "mitmproxy — 交互式中间人与脚本改包 | 装: pipx install mitmproxy | 验: mitmproxy --version",
    "scapy / dpkt — 构造与解析畸形报文 | 装: pipx install scapy dpkt | 验: python3 -c 'import scapy,dpkt'",
    "protoc + blackboxprotobuf — protobuf 无 schema 解析 | 装: apt install protobuf-compiler；pipx install blackboxprotobuf | 验: protoc --version",
    "Ghidra / IDA —— 从二进制还原协议状态机 | 装: apt install ghidra | 验: ghidraRun -version",
    "CyberChef — 字段编码/加密链快速试 | 装: docker run --rm -p 8080:80 mpepping/cyberchef | 验: 浏览器可开",
    "交付要含：字段表（偏移/长度/语义/取值）、时序图、以及「构造一条合法报文」的可运行脚本",
  ],
  crypto_impl: [
    "openssl — 算法调用与证书链检查 | 装: 系统自带（缺则 apt install openssl）| 验: openssl version",
    "pycryptodome / cryptography — 脚本化复现 | 装: pipx install pycryptodome cryptography | 验: python3 -c 'import Crypto,cryptography'",
    "z3-solver — 约束求解（弱随机、密钥恢复） | 装: pipx install z3-solver | 验: python3 -c 'import z3'",
    "SageMath — 数论与格基攻击 | 装: apt install sagemath（体积大，可用容器 sagemath/sagemath）| 验: sage --version",
    "RsaCtfTool / featherduster — 常见 RSA/异或弱点自动尝试 | 装: pipx install RsaCtfTool featherduster | 验: RsaCtfTool --help",
    "CyberChef — 编码/填充/padding oracle 手工推进 | 装: docker run --rm -p 8080:80 mpepping/cyberchef | 验: 浏览器可开",
    "结论要落到「哪一行实现错了 + 修法」；只给还原出的明文不算交付",
  ],
  chain: [
    "foundry (forge/cast/anvil) — 合约编译测试与链上交互 | 装: curl -L https://foundry.paradigm.xyz | bash && foundryup | 验: forge --version",
    "slither — 静态分析已知漏洞模式 | 装: pipx install slither-analyzer（需 solc）| 验: slither --version",
    "mythril / hevm — 符号执行验证可利用性 | 装: pipx install mythril | 验: myth --version",
    "web3.py / ethers.js — 脚本化读链 | 装: pipx install web3；npm i ethers | 验: python3 -c 'import web3'",
    "RPC 与浏览器：本地 anvil 或公共测试网；主网只读，写操作先在 fork 上验证",
    "结论含：函数名、触发序列、可提取价值量级、最小复现脚本",
  ],
  sidechannel: [
    "ChipWhisperer — 采集与攻击脚本（教学首选） | 装: pipx install chipwhisperer | 验: python3 -c 'import chipwhisperer'",
    "采集硬件：示波器/采集卡 + 触发器（Riscure Inspector 等属商业设备） | 装: 硬件到手后装官方驱动 | 验: 能稳定采到同一波形的对齐图",
    "numpy / scipy / matplotlib — 对齐、去噪、CPA/DPA 统计 | 装: pipx install numpy scipy matplotlib | 验: python3 -c 'import numpy,scipy'",
    "故障注入：电压/时钟毛刺设备 + 可回滚目标板——先写「预期故障模型」，再做实验",
    "结论要含：泄漏模型、采样参数、相关性峰值、假设检验；不能只给一张漂亮波形图",
  ],
  decrypt: [
    "hashcat — GPU 口令恢复与规则攻击 | 装: apt install hashcat | 验: hashcat --version",
    "john (jumbo) — CPU 兜底与多种格式转换 | 装: apt install john（jumbo 用官方 release）| 验: john --list=formats | head",
    "rockyou + best64 / OneRuleToRuleThemAll — 字典与规则 | 装: git clone --depth 1 https://github.com/danielmiessler/SecLists（或拷 Kali 自带 /usr/share/wordlists）| 验: ls -l rockyou.txt（无网时用项目自带小字典）",
    "CyberChef — 编码/古典密码/多层变换可视化推进 | 装: docker run --rm -p 8080:80 mpepping/cyberchef | 验: 浏览器可开",
    "RsaCtfTool / z3 / SageMath — 公钥与数论类恢复 | 装: pipx install RsaCtfTool z3-solver | 验: RsaCtfTool --help",
    "bkcrack — known-plaintext 解 ZipCrypto | 装: 源码 cmake 构建（或官方 release）| 验: bkcrack -h",
    "zip2john / rar2john / office2john — 归档与文档哈希提取 | 装: 随 john 提供 | 验: zip2john -h",
    "只对自有或授权数据做恢复；报告要写算法、规模（迭代数/密钥空间）、耗时与失败边界",
  ],
  stego: [
    "zsteg — PNG/BMP 位平面与 LSB 扫描 | 装: gem install zsteg（或官方 repo）| 验: zsteg --version",
    "steghide / outguess — JPEG 隐写提取 | 装: apt install steghide outguess | 验: steghide --version",
    "StegSolve / aperisolve — 图像通道与位平面可视 | 装: StegSolve jar 官方 release；aperisolve 用 docker | 验: 能切换通道查看",
    "exiftool — 元数据与注释区 | 装: apt install libimage-exiftool-perl | 验: exiftool -ver",
    "binwalk / pngcheck — 附加文件与结构异常 | 装: pipx install binwalk；apt install pngcheck | 验: binwalk --version",
    "音视频：sonic-visualiser + 频谱图（sox/ffmpeg 预处理） | 装: apt install sonic-visualiser sox ffmpeg | 验: sox --version",
    "顺序：元数据 → 通道/位平面 → 结构尾部附加 → LSB 统计 → 频谱/音频；每步都留证据文件",
  ],

  // ───────────────────────── data ─────────────────────────
  scraping: [
    "httpx/requests + lxml — 静态抓取与解析 | 装: pipx install httpx requests lxml beautifulsoup4 | 验: python3 -c 'import httpx,lxml'",
    "playwright — 需要执行 JS 的页面（含截图留证） | 装: pipx install playwright && playwright install chromium（本机已验证可装）| 验: playwright --version",
    "scrapy — 大规模爬取与去重调度 | 装: pipx install scrapy | 验: scrapy version",
    "jq / yq / pandas / duckdb — 清洗与结构化 | 装: apt install jq；pipx install pandas duckdb | 验: duckdb --version",
    "sqlite3 — 落地存储与 SQL 复查 | 装: apt install sqlite3 | 验: sqlite3 --version",
    "先读 robots.txt 与站点条款；限速、标识 UA、只取必要字段，把节流参数写进正文",
  ],
  deanon: [
    "maigret / sherlock — 用户名跨站足迹 | 装: pipx install maigret sherlock-project | 验: maigret --version",
    "exiftool — 文档与图片元数据关联 | 装: apt install libimage-exiftool-perl | 验: exiftool -ver",
    "networkx + pandas — 关联图与聚类 | 装: pipx install networkx pandas | 验: python3 -c 'import networkx'",
    "Maltego CE / spiderfoot — 实体图与自动采集 | 装: 官方安装包（CE 免费）；pipx install spiderfoot | 验: spiderfoot -h",
    "gowitness / playwright — 批量截图与页面留证 | 装: go install github.com/sensepost/gowitness@latest | 验: gowitness version",
    "每条关联都要给置信度与反驳条件（同名不同人）；个人身份汇聚必须在授权范围内，正文写明范围与数据来源",
  ],
  forensics: [
    "Volatility3 — 内存镜像进程/网络/注入痕迹 | 装: pipx install volatility3 | 验: vol -h",
    "sleuthkit + autopsy — 磁盘镜像与文件系统恢复 | 装: apt install sleuthkit autopsy | 验: fls -V",
    "plaso (log2timeline) — 统一时间线 | 装: pipx install plaso | 验: log2timeline.py --version",
    "bulk_extractor / foremost — 特征与文件雕刻 | 装: apt install bulk-extractor foremost | 验: bulk_extractor -V",
    "tshark / chainsaw / hayabusa — 流量与 Windows 事件日志 | 装: apt install tshark；chainsaw 与 hayabusa 用官方 release（Rust）| 验: tshark --version",
    "顺序：先镜像（dd/dcfldd + 校验和）再分析；只在副本上操作，原始介质写保护",
  ],

  compliance: [
    "pandoc — Markdown/清单转正式文书（PDF/DOCX） | 装: apt install pandoc texlive-xetex（或 pandoc 官方 deb）| 验: pandoc --version",
    "LibreOffice — 模板套用与批注痕迹清理 | 装: apt install libreoffice-writer | 验: libreoffice --version",
    "duckdb — 数据清单/数据地图的核对与去重 | 装: pipx install duckdb | 验: duckdb --version",
    "jq / yq — 隐私清单（JSON/YAML）批量核对字段 | 装: apt install jq（yq 官方 release）| 验: jq --version",
    "exiftool — 交付文档的元数据清理核验 | 装: apt install libimage-exiftool-perl | 验: exiftool -ver",
    "法规原文与模板一律给可核对的来源链接；不要凭记忆写条款编号",
  ],

  // ───────────────────────── engineering ─────────────────────────
  programming: [
    "语言运行时与版本管理器：nvm（node）/ pyenv（python）/ rustup（rust）/ go（官方 tarball）/ sdkman（java）/ asdf（混合）| 装: 各自的官方安装脚本 | 验: node -v / python3 -V / rustc -V / go version / java -version",
    "包管理：pnpm、uv/pipx、cargo、go mod、maven/gradle | 装: npm i -g pnpm；pipx install uv；其余随运行时 | 验: pnpm -v && uv --version",
    "构建：make/cmake/ninja（C/C++）、esbuild/vite/tsc（前端）、cargo/gradle（托管）| 装: apt install build-essential cmake ninja-build；npm i -g typescript esbuild | 验: cmake --version && tsc -v",
    "质量：ruff（py）、eslint/prettier（js）、clippy/rustfmt（rs）、shellcheck（sh）、semgrep（多语言） | 装: pipx install ruff semgrep；npm i -g eslint prettier；rustup component add clippy；apt install shellcheck | 验: ruff --version",
    "调试：pdb/ipdb、node --inspect、delve、gdb/lldb | 装: go install github.com/go-delve/delve/cmd/dlv@latest；apt install gdb | 验: dlv version",
    "测试：pytest、vitest/jest、go test、cargo test | 装: pipx install pytest；npm i -g vitest | 验: pytest --version",
    "新项目先跑一条端到端最小命令（能 build + 能 test），再谈架构——不要先写一堆未验证的目录结构",
  ],
  automation: [
    "jq / yq — JSON/YAML 管道处理 | 装: apt install jq（yq 官方 release）| 验: jq --version",
    "GNU parallel / xargs -P — 并发批处理 | 装: apt install parallel findutils | 验: parallel --version",
    "tmux — 长任务会话保持与日志回看 | 装: apt install tmux | 验: tmux -V",
    "cron / systemd timer — 定时任务（含开机自启） | 装: 系统自带 | 验: systemctl --version",
    "playwright / expect — 浏览器与交互式 CLI 自动化 | 装: pipx install playwright && playwright install chromium；apt install expect | 验: playwright --version",
    "rsync — 目录同步（缺失时用 cp -a + find -delete 或 tar 管道替代） | 装: apt install rsync（本机实测没有 rsync，替代写法见括号内）| 验: 同步后 diff -r 两边一致",
    "自动化脚本必须幂等 + 可 dry-run + 出错不吞：先 echo 再执行，失败就非零退出",
  ],
  code_eng: [
    "语言与包管理（按栈取一）：node+npm/pnpm、python+uv/pipx、rust+cargo、go mod、java+maven/gradle | 装: 官方安装脚本；pipx install uv | 验: node -v / python3 -V / cargo -V / go version",
    "构建与任务：make/cmake/ninja、vite/esbuild/tsc、bazel/gradle | 装: apt install build-essential cmake ninja-build | 验: cmake --version",
    "测试：pytest / vitest / go test / cargo test | 装: pipx install pytest；npm i -g vitest | 验: pytest --version",
    "静态检查与格式化：tsc、ruff、mypy、clippy、shellcheck、prettier | 装: pipx install ruff mypy；npm i -g prettier typescript | 验: ruff --version",
    "调试与剖析：gdb/lldb、delve、node --inspect、py-spy、perf | 装: pipx install py-spy；apt install gdb linux-perf | 验: py-spy --version",
    "重构交付格式：现状 →（可执行的一步）→ 目标；每步都能编译并通过测试，附回滚点",
  ],
  ops: [
    "journalctl / systemctl — 服务状态与日志 | 装: 系统自带 | 验: systemctl --version",
    "sysstat / htop / iotop — 资源画像 | 装: apt install sysstat htop iotop | 验: iostat -V && mpstat -V",
    "ss / netstat / tcpdump — 连接与流量 | 装: apt install iproute2 net-tools tcpdump | 验: ss -V",
    "strace / perf / bpftrace — 系统调用与热点 | 装: apt install strace linux-perf bpftrace | 验: perf --version",
    "docker / podman + compose — 复现环境 | 装: 官方脚本（或 apt install docker.io docker-compose-v2）| 验: docker compose version",
    "prometheus + grafana — 指标与看板 | 装: docker run --rm -p 9090:9090 prom/prometheus | 验: 打开 127.0.0.1:9090",
    "排障顺序固定：现象 → 指标 → 日志 → 追踪 → 变更核对；先给只读诊断命令，再谈修复动作",
  ],
  system_design: [
    "k6 / hey / vegeta — 容量与压力验证 | 装: 官方 release（k6）或 go install github.com/rakyll/hey@latest | 验: k6 version",
    "docker compose — 本地多组件拓扑复现 | 装: 官方脚本 | 验: docker compose version",
    "prometheus + grafana — 指标与瓶颈定位 | 装: docker run --rm -p 9090:9090 prom/prometheus | 验: 打开 127.0.0.1:9090",
    "postgres/redis 本地实例 — 验证索引与缓存假设 | 装: docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=x postgres | 验: psql --version",
    "设计交付含：容量假设与数字、单点、降级路径、可观测性指标；每条结论配实验或数据",
  ],
  analytics: [
    "duckdb — 单文件 OLAP 与 SQL 直查 | 装: pipx install duckdb（或官方 CLI）| 验: duckdb --version",
    "pandas / polars — 数据整形与统计 | 装: pipx install pandas polars | 验: python3 -c 'import pandas,polars'",
    "matplotlib / gnuplot — 图表产出 | 装: pipx install matplotlib；apt install gnuplot | 验: gnuplot --version",
    "jq / miller (mlr) — 结构化日志汇总 | 装: apt install jq miller | 验: mlr --version",
    "datasette — 结果快速发布为可查询界面 | 装: pipx install datasette | 验: datasette --version",
    "交付要含口径定义与样本量；图表坐标轴、单位、样本期齐备，别只贴一张没标注的图",
  ],
  product: [
    "表格与文档：LibreOffice / Markdown 表 + 版本化（PRD 用纯文本便于 diff） | 装: apt install libreoffice | 验: libreoffice --version",
    "指标与漏斗：duckdb + pandas（事件表聚合与留存曲线） | 装: pipx install duckdb pandas | 验: duckdb --version",
    "埋点核对：jq 校验事件负载字段是否齐全 | 装: apt install jq | 验: jq --version",
    "原型与流程图：Figma（在线）/ draw.io 桌面版（离线） | 装: 官方安装包 | 验: 能导出 PNG 与源文件",
    "实验设计：样本量与显著性用脚本算，别拍脑袋 | 装: pipx install scipy statsmodels | 验: python3 -c 'import scipy,statsmodels'",
    "每个结论都要给口径与数据来源；只有直觉没有数据的判断要标注为假设",
  ],
  game_design: [
    "数值建模：python3 + pandas/numpy（曲线拟合与平衡表） | 装: pipx install pandas numpy | 验: python3 -c 'import pandas,numpy'",
    "原型引擎：Godot（开源）/ Unity / 任意可跑的最小框架 | 装: apt install godot（或官方 release）| 验: godot --version",
    "表格与关卡：CSV/Markdown 表 + 版本化；关卡用 Tiled 等可读格式 | 装: 官方 release | 验: 能导入并导出同一张图",
    "可玩性验证：先做 30 秒核心循环原型再扩系统；把「玩家动作 → 反馈 → 数值变化」写成表",
  ],
};

// 便捷查询：给一个 id 取工具链（未定义返回空数组）
export function toolchainOf(id) {
  return TOOLCHAINS[id] ?? [];
}

export const TOOLCHAIN_IDS = Object.keys(TOOLCHAINS);

package com.deepseekharness.app;

interface IShellService {
    String exec(String cmd) = 0;
    // Native-only typed launcher; generic shell text may not invoke app_process.
    String execVirtualScreen(String command) = 1;
    // Shizuku 约定的销毁事务；升级或解绑时退出旧的特权服务进程。
    // AIDL adds FIRST_CALL_TRANSACTION (1) to the declared ID; preserve binder txn 16777114.
    void destroy() = 16777113;
}

/* DeepSeekHarness_NATIVE_PLUGIN_POLICY_V1：第三方写入与启用统一回到原生事务和内容审阅。 */
function deepseekharnessNativeManager() { return process.env.DeepSeekHarness_NATIVE_PLUGIN_MANAGER === '1'; }
function deepseekharnessManagedPlugin(manager, spec) {
  try {
    if (String(spec).includes('\\') || String(spec).split('/').some(part => !part || part === '.' || part === '..')) return false;
    const name = String(spec).match(/^(@[^/]+\/[^/]+|[^/]+)(?:\/|$)/)?.[1];
    if (!name) return false;
    const directory = deepseekharnessRealpath(resolveBundleDir('dsh', name, manager.profile.installAnchor, manager.profile.dir));
    const installation = deepseekharnessRealpath(deepseekharnessDirname(manager.profile.installAnchor));
    if (directory === installation || directory.startsWith(installation + deepseekharnessPathSeparator)) return true;
    const builtins = ['dsh-app-integration','dsh-web-mobile','dsh-status-overlay','dsh-task-notifier',
      'dsh-device-shell-guide','dsh-computer-use-android','dsh-auto-review'];
    return builtins.includes(name) && directory === deepseekharnessRealpath('/root/deepseekharness-' + name.slice(4));
  } catch { return false; }
}
function deepseekharnessNativePluginResult(stage, target) {
  return {stage,target,changed:false,application:'failed',error:{code:'operation-error',
    diagnostic:'DeepSeekHarness_NATIVE_REVIEW_REQUIRED: 请在 DEEPSEEK_HARNESS 的插件管理中安装、删除或审阅启用。Open DEEPSEEK_HARNESS plugin management to install, remove, or review activation.'}};
}

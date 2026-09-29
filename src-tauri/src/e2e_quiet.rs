//! 静默 E2E：让本地 `webdriver` 构建在测试期间不抢走开发者的键盘焦点。
//!
//! macOS 上 DataZen 共有三处会主动激活进程，全部发生在**第一个窗口之前或创建
//! 的那一瞬间**：
//!
//! 1. tao 的 `applicationDidFinishLaunching`（`AppState::launched`）里
//!    `window_activation_hack` + `activateIgnoringOtherApps:`；
//! 2. wry 每建一个 webview 都调一次 `-[NSApplication activate]`（macOS 14+，
//!    更早的系统上退化到 `activateIgnoringOtherApps:`）；
//! 3. 窗口 `show()` / `set_focus()` 走 `makeKeyAndOrderFront:`。
//!
//! 三处都得在**事件循环启动之前**处理掉：第 1 次发生在 Tauri 的 setup 钩子
//! 之前（实测把拦截写进 setup，进程照样在启动后 0.3s 被顶到前台，而那会儿第一个
//! 窗口还没建）。因此 [`install`] 由 `bootstrap/run.rs` 在构造
//! `tauri::Builder` 之前调用，做两件事：
//!
//! - 把本进程 `NSApplication` 基类上的 `activate` / `activateIgnoringOtherApps:`
//!   换成空实现（ObjC 方法替换是进程内的，系统里其它应用不受影响）；
//! - 把激活策略降级为 `Accessory`——这个进程不再能被系统激活，没有 Dock 图标、
//!   不进 Cmd-Tab，窗口却照常显示和渲染，`show()` 的那条内部激活路径也随之失效。
//!
//! 只设策略不换选择器、或者只在 setup 里做，都拦不住启动那一次；两件事一起做
//! 才稳定。
//!
//! 未设置该变量时 [`install`] 是彻底的空操作，`e2e:shots` 画廊采集与
//! `demo-recording` 演示录制因此照旧跑可见窗口。

/// 打开静默模式的开关环境变量，取值 `1` / `true`。
#[cfg(feature = "webdriver")]
pub const ENV_VAR: &str = "DATAZEN_E2E_QUIET";

/// 本次进程是否处于静默 E2E 模式。
///
/// 不带 `webdriver` feature 的构建恒为 `false`，因此生产二进制里既没有这段
/// 开关逻辑，也没有下面的 macOS shim。
#[must_use]
pub fn enabled() -> bool {
    #[cfg(feature = "webdriver")]
    {
        std::env::var(ENV_VAR).is_ok_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    }
    #[cfg(not(feature = "webdriver"))]
    {
        false
    }
}

/// 安装激活拦截。必须在 `tauri::Builder` 构造之前调用（见 `bootstrap/run.rs`）；
/// 未设置环境变量时是彻底的空操作，因此 `e2e:shots` / `e2e:demo` 这类需要
/// 真实前台窗口的运行完全不受影响。
pub fn install() {
    if !enabled() {
        return;
    }
    #[cfg(all(feature = "webdriver", target_os = "macos"))]
    refuse_activation();
}

/// 在事件循环启动之前，把本进程 `NSApplication` 的两个激活选择器替换为空实现，
/// 并把激活策略降级为 `Accessory`。
///
/// 必须早于 `tauri::Builder` 构造：tao 在 `applicationDidFinishLaunching`
/// （`AppState::launched`）里就会调 `window_activation_hack` +
/// `activateIgnoringOtherApps`，wry 每建一个 webview 也会调 `activate`。那两次
/// 都早于 Tauri 的 setup 钩子——实测把拦截放在 setup 里毫无作用，启动后 0.3s
/// 就被顶到前台。
///
/// 因此这里替换的是 **`NSApplication` 基类本身**：调用点此时还没建出 tao 的
/// `TaoApp` 子类（`object_setClass` 发生在事件循环里），而 `TaoApp` 并不自己实现
/// 这两个选择器，消息仍会落到基类上。ObjC 的方法替换是**进程内**的，系统里其它
/// 应用不受影响。WebDriver 走 JS 合成事件与 `takeScreenshot`，都不要求应用激活。
#[cfg(all(feature = "webdriver", target_os = "macos"))]
fn refuse_activation() {
    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{sel, ClassType, MainThreadMarker};

    extern "C-unwind" fn ignore(_: &AnyObject, _: Sel) {}
    extern "C-unwind" fn ignore_with_flag(_: &AnyObject, _: Sel, _: Bool) {}

    let Some(mtm) = MainThreadMarker::new() else {
        tracing::warn!(
            env = ENV_VAR,
            "not on the main thread — activation stays enabled"
        );
        return;
    };

    // 策略降级是第一道闸：Accessory 进程不会被系统激活，也没有 Dock 图标。
    // 提前 `sharedApplication()` 顺带把单例建出来，此时还没有任何窗口，
    // setActivationPolicy 一定被接受。
    let app = objc2_app_kit::NSApplication::sharedApplication(mtm);
    let policy_set =
        app.setActivationPolicy(objc2_app_kit::NSApplicationActivationPolicy::Accessory);

    let class: &'static AnyClass = objc2_app_kit::NSApplication::class();
    let overrides: [(Sel, Imp); 2] = [
        (sel!(activate), unsafe {
            std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel), Imp>(ignore)
        }),
        (sel!(activateIgnoringOtherApps:), unsafe {
            std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, Bool), Imp>(
                ignore_with_flag,
            )
        }),
    ];

    let mut replaced = 0usize;
    for (selector, imp) in overrides {
        // `activate` 只有 macOS 14+ 才有；缺失就跳过，不影响另一个选择器。
        let Some(method) = class.instance_method(selector) else {
            tracing::warn!(
                env = ENV_VAR,
                "activation selector missing — left untouched"
            );
            continue;
        };
        // SAFETY: `class` 是已注册的类，替换实现沿用被替换方法的类型编码，
        // 签名（含 `Bool` 入参）与原方法一致，符合 ObjC 对 IMP 的要求。
        unsafe {
            ffi::class_replaceMethod(
                std::ptr::from_ref(class).cast_mut(),
                selector,
                imp,
                ffi::method_getTypeEncoding(method),
            );
        }
        replaced += 1;
    }

    if !policy_set {
        tracing::error!(
            env = ENV_VAR,
            "setActivationPolicy(Accessory) refused — the app may still steal focus"
        );
    }
    if replaced == 0 {
        tracing::error!(
            env = ENV_VAR,
            "e2e quiet mode: no activation selector was replaced"
        );
    } else {
        tracing::info!(
            env = ENV_VAR,
            replaced,
            accessory = policy_set,
            "e2e quiet mode: app activation refused"
        );
    }
}

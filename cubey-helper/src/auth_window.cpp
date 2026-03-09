#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <cstdio>
#include <thread>
#include <string>
#include <sstream>
#include <algorithm>
#include <vector>

#if defined(__has_include)
#if defined(IVLYRICS_HAS_WEBVIEW2) && IVLYRICS_HAS_WEBVIEW2 && __has_include(<WebView2.h>)
#define IVLYRICS_CAN_USE_WEBVIEW2 1
#else
#define IVLYRICS_CAN_USE_WEBVIEW2 0
#endif
#else
#if defined(IVLYRICS_HAS_WEBVIEW2) && IVLYRICS_HAS_WEBVIEW2
#define IVLYRICS_CAN_USE_WEBVIEW2 1
#else
#define IVLYRICS_CAN_USE_WEBVIEW2 0
#endif
#endif

#if IVLYRICS_CAN_USE_WEBVIEW2
#include <wrl.h>
#include <nlohmann/json.hpp>
#include <WebView2.h>
#endif

#include "auth_window.h"

#if IVLYRICS_CAN_USE_WEBVIEW2
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
#endif

namespace {

void set_status(const std::shared_ptr<AuthWindowManager::AuthSession>& session,
                const std::string& state,
                const std::string& error = {},
                const BootstrapResult* bootstrap = nullptr) {
    std::lock_guard<std::mutex> lock(session->mu);
    session->status.state = state;
    session->status.error = error;
    if (bootstrap) {
        session->status.session_id = bootstrap->session_id;
        session->status.expires_at = bootstrap->expires_at;
        session->status.upstream_status = bootstrap->upstream_status;
        session->status.upstream_body_excerpt = bootstrap->upstream_body_excerpt;
    }
}

#if IVLYRICS_CAN_USE_WEBVIEW2

struct WebViewRuntime {
    std::shared_ptr<AuthWindowManager::AuthSession> session;
    CubeyApi* cubey = nullptr;
    std::string base_url;
    HWND hwnd = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
};

std::string to_utf8(const std::wstring& ws) {
    if (ws.empty()) return {};
    const int len = WideCharToMultiByte(CP_UTF8, 0, ws.data(), static_cast<int>(ws.size()), nullptr, 0, nullptr, nullptr);
    std::string out(len, 0);
    WideCharToMultiByte(CP_UTF8, 0, ws.data(), static_cast<int>(ws.size()), out.data(), len, nullptr, nullptr);
    return out;
}

std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    const int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(len, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), len);
    return out;
}

std::string escape_html_attr(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 16);
    for (char ch : value) {
        switch (ch) {
        case '&': out += "&amp;"; break;
        case '"': out += "&quot;"; break;
        case '\'': out += "&#39;"; break;
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        default: out.push_back(ch); break;
        }
    }
    return out;
}

std::string build_wrapper_html(const std::string& base_url) {
    const auto safe_base_url = escape_html_attr(base_url);
    std::ostringstream html;
    html
        << "<!DOCTYPE html><html><head><meta charset=\"utf-8\">"
        << "<title>ivLyrics Cubey Authentication</title>"
        << "<style>"
        << "html,body{margin:0;padding:0;background:#111;color:#fff;font-family:Segoe UI,Arial,sans-serif;}"
        << "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100vh;}"
        << ".hint{font-size:13px;opacity:.78;text-align:center;max-width:360px;line-height:1.45;}"
        << "iframe{width:320px;height:80px;border:none;background:transparent;}"
        << "</style></head><body>"
        << "<div class=\"hint\">Cloudflare verification is required once. Complete it here to allow Cubey rich-sync requests.</div>"
        << "<iframe id=\"challenge\" src=\"" << safe_base_url << "/challenge\" allow=\"cross-origin-isolated\"></iframe>"
        << "<script>"
        << "const bridge=(payload)=>window.chrome&&window.chrome.webview&&window.chrome.webview.postMessage(JSON.stringify(payload));"
        << "window.addEventListener('message',(event)=>{"
        << " const data=event.data||{};"
        << " if(data.type==='turnstile-token'||data.type==='turnstile-error'||data.type==='turnstile-timeout'){bridge(data);}"
        << " else if(data.type==='turnstile-expired'){"
        << "   const frame=document.getElementById('challenge');"
        << "   frame&&frame.contentWindow&&frame.contentWindow.postMessage({type:'reset-turnstile'},'*');"
        << " }"
        << "});"
        << "</script></body></html>";
    return html.str();
}

std::vector<std::string> collect_webview_cookie_pairs(ICoreWebView2CookieList* cookie_list) {
    std::vector<std::string> cookies;
    if (!cookie_list) {
        return cookies;
    }

    UINT count = 0;
    if (FAILED(cookie_list->get_Count(&count))) {
        return cookies;
    }

    for (UINT index = 0; index < count; ++index) {
        ComPtr<ICoreWebView2Cookie> cookie;
        if (FAILED(cookie_list->GetValueAtIndex(index, &cookie)) || !cookie) {
            continue;
        }

        LPWSTR raw_name = nullptr;
        LPWSTR raw_value = nullptr;
        if (FAILED(cookie->get_Name(&raw_name)) || FAILED(cookie->get_Value(&raw_value))) {
            if (raw_name) CoTaskMemFree(raw_name);
            if (raw_value) CoTaskMemFree(raw_value);
            continue;
        }

        const auto name = to_utf8(raw_name ? std::wstring(raw_name) : std::wstring());
        const auto value = to_utf8(raw_value ? std::wstring(raw_value) : std::wstring());
        if (raw_name) CoTaskMemFree(raw_name);
        if (raw_value) CoTaskMemFree(raw_value);

        if (!name.empty()) {
            cookies.push_back(name + "=" + value);
        }
    }

    return cookies;
}

LRESULT CALLBACK AuthWindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
    auto* runtime = reinterpret_cast<WebViewRuntime*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (message) {
    case WM_NCCREATE: {
        auto* create_struct = reinterpret_cast<CREATESTRUCTW*>(lparam);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create_struct->lpCreateParams));
        return TRUE;
    }
    case WM_SIZE:
        if (runtime && runtime->controller) {
            RECT bounds{};
            GetClientRect(hwnd, &bounds);
            runtime->controller->put_Bounds(bounds);
        }
        return 0;
    case WM_CLOSE:
        if (runtime && runtime->session) {
            std::lock_guard<std::mutex> lock(runtime->session->mu);
            if (runtime->session->status.state == "pending") {
                runtime->session->status.state = "error";
                runtime->session->status.error = "auth_cancelled";
            }
        }
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
}

bool ensure_window_class_registered() {
    static bool registered = false;
    if (registered) return true;

    WNDCLASSW wc{};
    wc.lpfnWndProc = AuthWindowProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"ivLyricsCubeyAuthWindow";
    wc.hCursor = LoadCursorW(nullptr, reinterpret_cast<LPCWSTR>(IDC_ARROW));
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);

    if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
        return false;
    }
    registered = true;
    return true;
}

} // namespace
#endif

AuthWindowManager::AuthWindowManager(CubeyApi& cubey)
    : cubey_(cubey) {}

std::string AuthWindowManager::generate_id() {
    GUID guid{};
    if (SUCCEEDED(CoCreateGuid(&guid))) {
        char buffer[64];
        snprintf(buffer, sizeof(buffer),
                 "%08lx-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x",
                 guid.Data1, guid.Data2, guid.Data3,
                 guid.Data4[0], guid.Data4[1], guid.Data4[2], guid.Data4[3],
                 guid.Data4[4], guid.Data4[5], guid.Data4[6], guid.Data4[7]);
        return buffer;
    }
    return "auth-fallback";
}

AuthWindowStatus AuthWindowManager::start(const std::string& base_url) {
    auto session = std::make_shared<AuthSession>();
    session->base_url = base_url;
    session->status.auth_id = generate_id();
    session->status.state = "pending";

    {
        std::lock_guard<std::mutex> lock(sessions_mu_);
        sessions_[session->status.auth_id] = session;
    }

    std::thread([this, session]() {
        run_auth_session(session);
    }).detach();

    std::lock_guard<std::mutex> lock(session->mu);
    return session->status;
}

AuthWindowStatus AuthWindowManager::get_status(const std::string& auth_id) {
    std::shared_ptr<AuthSession> session;
    {
        std::lock_guard<std::mutex> lock(sessions_mu_);
        auto it = sessions_.find(auth_id);
        if (it != sessions_.end()) {
            session = it->second;
        }
    }

    AuthWindowStatus status;
    status.auth_id = auth_id;
    status.state = "error";
    status.error = "auth_not_found";
    if (!session) return status;

    std::lock_guard<std::mutex> lock(session->mu);
    return session->status;
}

void AuthWindowManager::run_auth_session(const std::shared_ptr<AuthSession>& session) {
#if !IVLYRICS_CAN_USE_WEBVIEW2
    set_status(session, "error", "webview2_sdk_missing");
    return;
#else
    const HRESULT coinit = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    const bool should_uninit = SUCCEEDED(coinit);

    if (!ensure_window_class_registered()) {
        set_status(session, "error", "window_class_register_failed");
        if (should_uninit) CoUninitialize();
        return;
    }

    auto runtime = std::make_unique<WebViewRuntime>();
    runtime->session = session;
    runtime->cubey = &cubey_;
    runtime->base_url = session->base_url;

    HWND hwnd = CreateWindowExW(
        0,
        L"ivLyricsCubeyAuthWindow",
        L"ivLyrics Cubey Authentication",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        420,
        240,
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        runtime.get()
    );

    if (!hwnd) {
        set_status(session, "error", "window_create_failed");
        if (should_uninit) CoUninitialize();
        return;
    }

    runtime->hwnd = hwnd;
    ShowWindow(hwnd, SW_SHOW);
    UpdateWindow(hwnd);

    auto webview_ready = std::make_shared<bool>(false);

    const auto env_completed = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
        [runtime_ptr = runtime.get(), webview_ready](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            if (FAILED(result) || !environment) {
                set_status(runtime_ptr->session, "error", "webview2_environment_failed");
                PostMessageW(runtime_ptr->hwnd, WM_CLOSE, 0, 0);
                return S_OK;
            }

            environment->CreateCoreWebView2Controller(
                runtime_ptr->hwnd,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [runtime_ptr, webview_ready](HRESULT controller_result, ICoreWebView2Controller* controller) -> HRESULT {
                        if (FAILED(controller_result) || !controller) {
                            set_status(runtime_ptr->session, "error", "webview2_controller_failed");
                            PostMessageW(runtime_ptr->hwnd, WM_CLOSE, 0, 0);
                            return S_OK;
                        }

                        runtime_ptr->controller = controller;
                        runtime_ptr->controller->get_CoreWebView2(&runtime_ptr->webview);
                        if (!runtime_ptr->webview) {
                            set_status(runtime_ptr->session, "error", "webview2_core_failed");
                            PostMessageW(runtime_ptr->hwnd, WM_CLOSE, 0, 0);
                            return S_OK;
                        }

                        RECT bounds{};
                        GetClientRect(runtime_ptr->hwnd, &bounds);
                        runtime_ptr->controller->put_Bounds(bounds);

                        runtime_ptr->webview->add_WebMessageReceived(
                            Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                [runtime_ptr](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                    LPWSTR message = nullptr;
                                    if (FAILED(args->TryGetWebMessageAsString(&message))) {
                                        return S_OK;
                                    }

                                    const auto payload = nlohmann::json::parse(to_utf8(message ? std::wstring(message) : std::wstring()), nullptr, false);
                                    if (message) {
                                        CoTaskMemFree(message);
                                    }
                                    if (payload.is_discarded()) {
                                        return S_OK;
                                    }

                                    const auto type = payload.value("type", "");
                                    if (type == "turnstile-token") {
                                        const auto token = payload.value("token", "");
                                        if (token.empty()) {
                                            set_status(runtime_ptr->session, "error", "turnstile_empty_token");
                                            PostMessageW(runtime_ptr->hwnd, WM_CLOSE, 0, 0);
                                        } else {
                                            set_status(runtime_ptr->session, "authorizing");

                                            ComPtr<ICoreWebView2_2> webview2;
                                            ComPtr<ICoreWebView2CookieManager> cookie_manager;
                                            const auto finalize_bootstrap = [runtime_ptr, token](std::vector<std::string> challenge_cookies) {
                                                const auto bootstrap = runtime_ptr->cubey->bootstrap(token, runtime_ptr->base_url, challenge_cookies);
                                                if (bootstrap.success) {
                                                    set_status(runtime_ptr->session, "ready", {}, &bootstrap);
                                                } else {
                                                    set_status(runtime_ptr->session, "error", bootstrap.error, &bootstrap);
                                                }
                                                PostMessageW(runtime_ptr->hwnd, WM_CLOSE, 0, 0);
                                            };

                                            if (FAILED(runtime_ptr->webview.As(&webview2)) ||
                                                !webview2 ||
                                                FAILED(webview2->get_CookieManager(&cookie_manager)) ||
                                                !cookie_manager) {
                                                finalize_bootstrap({});
                                            } else {
                                                const auto cookie_uri = runtime_ptr->base_url + "/challenge";
                                                const auto get_cookie_result = cookie_manager->GetCookies(
                                                    to_wide(cookie_uri).c_str(),
                                                    Callback<ICoreWebView2GetCookiesCompletedHandler>(
                                                        [runtime_ptr, finalize_bootstrap](HRESULT cookie_result, ICoreWebView2CookieList* cookie_list) -> HRESULT {
                                                            std::vector<std::string> challenge_cookies;
                                                            if (SUCCEEDED(cookie_result)) {
                                                                challenge_cookies = collect_webview_cookie_pairs(cookie_list);
                                                            }
                                                            finalize_bootstrap(std::move(challenge_cookies));
                                                            return S_OK;
                                                        }).Get()
                                                );
                                                if (FAILED(get_cookie_result)) {
                                                    finalize_bootstrap({});
                                                }
                                            }
                                        }
                                    } else if (type == "turnstile-error" || type == "turnstile-timeout") {
                                        set_status(runtime_ptr->session, "error", payload.value("error", type));
                                        PostMessageW(runtime_ptr->hwnd, WM_CLOSE, 0, 0);
                                    }

                                    return S_OK;
                                }).Get(),
                            nullptr
                        );

                        const auto wrapper = build_wrapper_html(runtime_ptr->base_url);
                        runtime_ptr->webview->NavigateToString(to_wide(wrapper).c_str());
                        *webview_ready = true;
                        return S_OK;
                    }).Get()
            );

            return S_OK;
        }
    );

    const auto package_root = std::wstring(L"");
    CreateCoreWebView2EnvironmentWithOptions(nullptr, package_root.c_str(), nullptr, env_completed.Get());

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    runtime.reset();
    if (should_uninit) CoUninitialize();
#endif
}

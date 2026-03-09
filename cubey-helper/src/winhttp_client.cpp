#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#include "winhttp_client.h"
#include <sstream>
#include <vector>
#include <algorithm>
#include <cctype>

#pragma comment(lib, "winhttp.lib")

namespace {

struct UrlParts {
    bool https = true;
    std::wstring host;
    INTERNET_PORT port = INTERNET_DEFAULT_HTTPS_PORT;
    std::wstring path;
};

std::wstring to_wide(const std::string& s) {
    if (s.empty()) return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring ws(len, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), ws.data(), len);
    return ws;
}

std::string to_utf8(const std::wstring& ws) {
    if (ws.empty()) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, ws.data(), (int)ws.size(), nullptr, 0, nullptr, nullptr);
    std::string s(len, 0);
    WideCharToMultiByte(CP_UTF8, 0, ws.data(), (int)ws.size(), s.data(), len, nullptr, nullptr);
    return s;
}

bool parse_url(const std::string& url, UrlParts& out) {
    auto wurl = to_wide(url);

    URL_COMPONENTS uc = {};
    uc.dwStructSize = sizeof(uc);

    wchar_t host_buf[256] = {};
    wchar_t path_buf[2048] = {};
    wchar_t extra_buf[4096] = {};

    uc.lpszHostName = host_buf;
    uc.dwHostNameLength = 256;
    uc.lpszUrlPath = path_buf;
    uc.dwUrlPathLength = 2048;
    uc.lpszExtraInfo = extra_buf;
    uc.dwExtraInfoLength = 4096;

    if (!WinHttpCrackUrl(wurl.c_str(), (DWORD)wurl.size(), 0, &uc))
        return false;

    out.host = host_buf;
    out.port = uc.nPort;
    out.path = path_buf;
    if (extra_buf[0] != L'\0') {
        out.path += extra_buf;
    }
    if (out.path.empty()) {
        out.path = L"/";
    }
    out.https = (uc.nScheme == INTERNET_SCHEME_HTTPS);
    return true;
}

std::string trim_ascii(std::string value) {
    auto is_space = [](unsigned char ch) { return std::isspace(ch) != 0; };
    value.erase(value.begin(), std::find_if_not(value.begin(), value.end(), is_space));
    while (!value.empty() && is_space(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

bool starts_with_no_case(const std::string& value, const char* prefix) {
    size_t i = 0;
    for (; prefix[i] != '\0'; ++i) {
        if (i >= value.size()) return false;
        if (std::tolower(static_cast<unsigned char>(value[i])) !=
            std::tolower(static_cast<unsigned char>(prefix[i]))) {
            return false;
        }
    }
    return true;
}

std::string query_raw_headers(HINTERNET req) {
    DWORD size = 0;
    if (WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF,
                            WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER,
                            &size, WINHTTP_NO_HEADER_INDEX) ||
        GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
        size == 0) {
        return {};
    }

    std::wstring raw(size / sizeof(wchar_t), L'\0');
    if (!WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF,
                             WINHTTP_HEADER_NAME_BY_INDEX, raw.data(),
                             &size, WINHTTP_NO_HEADER_INDEX)) {
        return {};
    }

    while (!raw.empty() && raw.back() == L'\0') {
        raw.pop_back();
    }
    return to_utf8(raw);
}

std::vector<std::string> extract_set_cookie_headers(const std::string& raw_headers) {
    std::vector<std::string> cookies;
    std::istringstream iss(raw_headers);
    std::string line;
    while (std::getline(iss, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (!starts_with_no_case(line, "Set-Cookie:")) {
            continue;
        }
        const auto pos = line.find(':');
        if (pos == std::string::npos) {
            continue;
        }
        const auto value = trim_ascii(line.substr(pos + 1));
        if (!value.empty()) {
            cookies.push_back(value);
        }
    }
    return cookies;
}

} // namespace

WinHttpClient::WinHttpClient() {
    session_ = WinHttpOpen(L"cubey-helper/0.1",
                           WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                           WINHTTP_NO_PROXY_NAME,
                           WINHTTP_NO_PROXY_BYPASS, 0);
}

WinHttpClient::~WinHttpClient() {
    if (session_) {
        WinHttpCloseHandle(static_cast<HINTERNET>(session_));
        session_ = nullptr;
    }
}

HttpResponse WinHttpClient::get(const std::string& url,
                                 const std::map<std::string, std::string>& headers,
                                 int timeout_ms) {
    return request("GET", url, "", headers, timeout_ms);
}

HttpResponse WinHttpClient::post(const std::string& url,
                                  const std::string& body,
                                  const std::string& content_type,
                                  const std::map<std::string, std::string>& headers,
                                  int timeout_ms) {
    auto hdrs = headers;
    hdrs["Content-Type"] = content_type;
    return request("POST", url, body, hdrs, timeout_ms);
}

HttpResponse WinHttpClient::request(const std::string& method,
                                     const std::string& url,
                                     const std::string& body,
                                     const std::map<std::string, std::string>& headers,
                                     int timeout_ms) {
    std::lock_guard<std::mutex> lk(mu_);
    HttpResponse resp;

    UrlParts parts;
    if (!parse_url(url, parts)) {
        resp.error = "Failed to parse URL: " + url;
        return resp;
    }

    HINTERNET session = static_cast<HINTERNET>(session_);
    if (!session) {
        resp.error = "WinHttpOpen failed";
        return resp;
    }

    // Set timeouts
    WinHttpSetTimeouts(session, timeout_ms, timeout_ms, timeout_ms, timeout_ms);

    HINTERNET conn = WinHttpConnect(session, parts.host.c_str(), parts.port, 0);
    if (!conn) {
        resp.error = "WinHttpConnect failed";
        return resp;
    }

    DWORD flags = parts.https ? WINHTTP_FLAG_SECURE : 0;
    auto wmethod = to_wide(method);

    HINTERNET req = WinHttpOpenRequest(conn, wmethod.c_str(),
                                        parts.path.c_str(),
                                        nullptr, WINHTTP_NO_REFERER,
                                        WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!req) {
        resp.error = "WinHttpOpenRequest failed";
        WinHttpCloseHandle(conn);
        return resp;
    }

    // Add headers
    for (const auto& [key, val] : headers) {
        auto header_line = to_wide(key + ": " + val);
        WinHttpAddRequestHeaders(req, header_line.c_str(), (DWORD)-1,
                                  WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
    }

    // Send
    LPVOID body_ptr = body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.data();
    DWORD body_len = body.empty() ? 0 : (DWORD)body.size();

    BOOL sent = WinHttpSendRequest(req, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                    body_ptr, body_len, body_len, 0);
    if (!sent) {
        resp.error = "WinHttpSendRequest failed: " + std::to_string(GetLastError());
        WinHttpCloseHandle(req);
        WinHttpCloseHandle(conn);
        return resp;
    }

    if (!WinHttpReceiveResponse(req, nullptr)) {
        resp.error = "WinHttpReceiveResponse failed: " + std::to_string(GetLastError());
        WinHttpCloseHandle(req);
        WinHttpCloseHandle(conn);
        return resp;
    }

    // Status code
    DWORD status = 0;
    DWORD status_size = sizeof(status);
    WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size,
                        WINHTTP_NO_HEADER_INDEX);
    resp.status_code = (int)status;
    resp.raw_headers = query_raw_headers(req);
    resp.set_cookie_headers = extract_set_cookie_headers(resp.raw_headers);

    // Read body
    std::ostringstream oss;
    DWORD bytes_available = 0;
    while (WinHttpQueryDataAvailable(req, &bytes_available) && bytes_available > 0) {
        std::vector<char> buf(bytes_available);
        DWORD bytes_read = 0;
        if (WinHttpReadData(req, buf.data(), bytes_available, &bytes_read)) {
            oss.write(buf.data(), bytes_read);
        }
        bytes_available = 0;
    }
    resp.body = oss.str();

    WinHttpCloseHandle(req);
    WinHttpCloseHandle(conn);
    return resp;
}

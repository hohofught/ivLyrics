#pragma once
#include <string>
#include <map>
#include <mutex>
#include <vector>

struct HttpResponse {
    int status_code = 0;
    std::string body;
    std::string error;
    std::string raw_headers;
    std::vector<std::string> set_cookie_headers;
    bool ok() const { return status_code >= 200 && status_code < 300; }
};

class WinHttpClient {
public:
    WinHttpClient();
    ~WinHttpClient();
    WinHttpClient(const WinHttpClient&) = delete;
    WinHttpClient& operator=(const WinHttpClient&) = delete;

    HttpResponse get(const std::string& url,
                     const std::map<std::string, std::string>& headers = {},
                     int timeout_ms = 15000);

    HttpResponse post(const std::string& url,
                      const std::string& body,
                      const std::string& content_type = "application/json",
                      const std::map<std::string, std::string>& headers = {},
                      int timeout_ms = 15000);

private:
    void* session_ = nullptr;
    std::mutex mu_;

    HttpResponse request(const std::string& method,
                         const std::string& url,
                         const std::string& body,
                         const std::map<std::string, std::string>& headers,
                         int timeout_ms);
};

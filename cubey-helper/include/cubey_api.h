#pragma once
#include "winhttp_client.h"
#include "session_store.h"
#include <nlohmann/json.hpp>
#include <string>
#include <mutex>

struct BootstrapResult {
    bool success = false;
    std::string session_id;
    int64_t expires_at = 0;
    std::string error;
    int upstream_status = 0;
    std::string upstream_body_excerpt;
};

struct LyricsResult {
    bool success = false;
    nlohmann::json data;
    std::string error;
    bool reauth_required = false;
    int upstream_status = 0;
    std::string upstream_body_excerpt;
};

class CubeyApi {
public:
    CubeyApi(SessionStore& store);

    BootstrapResult bootstrap(const std::string& turnstile_token,
                               const std::string& base_url,
                               const std::vector<std::string>& challenge_cookies = {});

    LyricsResult fetch_lyrics(const std::string& session_id,
                               const std::string& song,
                               const std::string& artist,
                               const std::string& album,
                               int duration_seconds,
                               const std::string& video_id = "");

private:
    WinHttpClient http_;
    SessionStore& store_;
    std::mutex mu_;

    std::string verify_turnstile(const std::string& base_url,
                                  const std::string& turnstile_token,
                                  int* upstream_status,
                                  std::string* upstream_body_excerpt,
                                  std::vector<std::string>* out_cookies,
                                  const std::vector<std::string>& challenge_cookies = {});
    int64_t decode_jwt_exp_ms(const std::string& jwt);
    static std::string make_body_excerpt(const std::string& body);
};

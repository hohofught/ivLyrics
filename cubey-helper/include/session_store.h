#pragma once
#include <string>
#include <vector>
#include <mutex>
#include <unordered_map>
#include <chrono>
#include <optional>

struct Session {
    std::string session_id;
    std::string jwt;
    std::string base_url;
    int64_t jwt_exp_ms = 0;
    int64_t created_at = 0;
    int64_t last_used_at = 0;
    std::vector<std::string> upstream_cookies;
};

class SessionStore {
public:
    static constexpr int64_t REFRESH_MARGIN_MS = 45000;

    std::string create(const std::string& jwt, const std::string& base_url, int64_t jwt_exp_ms,
                       const std::vector<std::string>& upstream_cookies = {});
    std::optional<Session> get(const std::string& session_id);
    void invalidate(const std::string& session_id);
    void cleanup_expired();
    bool is_jwt_usable(const Session& s) const;

private:
    std::mutex mu_;
    std::unordered_map<std::string, Session> sessions_;

    static int64_t now_ms();
    static std::string generate_id();
};

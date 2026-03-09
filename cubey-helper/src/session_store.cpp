#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include "session_store.h"
#include <algorithm>
#include <sstream>
#include <iomanip>

#pragma comment(lib, "ole32.lib")

int64_t SessionStore::now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::string SessionStore::generate_id() {
    GUID guid;
    if (SUCCEEDED(CoCreateGuid(&guid))) {
        char buf[64];
        snprintf(buf, sizeof(buf),
                 "%08lx-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x",
                 guid.Data1, guid.Data2, guid.Data3,
                 guid.Data4[0], guid.Data4[1],
                 guid.Data4[2], guid.Data4[3],
                 guid.Data4[4], guid.Data4[5],
                 guid.Data4[6], guid.Data4[7]);
        return std::string(buf);
    }
    // Fallback: timestamp-based
    auto ts = now_ms();
    std::ostringstream oss;
    oss << "ses-" << std::hex << ts;
    return oss.str();
}

std::string SessionStore::create(const std::string& jwt,
                                  const std::string& base_url,
                                  int64_t jwt_exp_ms,
                                  const std::vector<std::string>& upstream_cookies) {
    std::lock_guard<std::mutex> lk(mu_);

    const std::string session_id = generate_id();

    Session s;
    s.session_id = session_id;
    s.jwt = jwt;
    s.base_url = base_url;
    s.jwt_exp_ms = jwt_exp_ms;
    s.created_at = now_ms();
    s.last_used_at = s.created_at;
    s.upstream_cookies = upstream_cookies;

    sessions_[session_id] = std::move(s);
    return session_id;
}

std::optional<Session> SessionStore::get(const std::string& session_id) {
    std::lock_guard<std::mutex> lk(mu_);

    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return std::nullopt;

    it->second.last_used_at = now_ms();
    return it->second;
}

void SessionStore::invalidate(const std::string& session_id) {
    std::lock_guard<std::mutex> lk(mu_);
    sessions_.erase(session_id);
}

void SessionStore::cleanup_expired() {
    std::lock_guard<std::mutex> lk(mu_);
    auto ts = now_ms();

    for (auto it = sessions_.begin(); it != sessions_.end();) {
        if (it->second.jwt_exp_ms > 0 && it->second.jwt_exp_ms < ts) {
            it = sessions_.erase(it);
        } else {
            ++it;
        }
    }
}

bool SessionStore::is_jwt_usable(const Session& s) const {
    if (s.jwt.empty()) return false;
    if (s.jwt_exp_ms <= 0) return false;
    return (s.jwt_exp_ms - now_ms()) > REFRESH_MARGIN_MS;
}

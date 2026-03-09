#pragma once

#include "cubey_api.h"
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

struct AuthWindowStatus {
    std::string auth_id;
    std::string state = "pending";
    std::string error;
    std::string session_id;
    int64_t expires_at = 0;
    int upstream_status = 0;
    std::string upstream_body_excerpt;
};

class AuthWindowManager {
public:
    struct AuthSession {
        mutable std::mutex mu;
        AuthWindowStatus status;
        std::string base_url;
    };

    explicit AuthWindowManager(CubeyApi& cubey);

    AuthWindowStatus start(const std::string& base_url);
    AuthWindowStatus get_status(const std::string& auth_id);

private:
    CubeyApi& cubey_;
    std::mutex sessions_mu_;
    std::unordered_map<std::string, std::shared_ptr<AuthSession>> sessions_;

    static std::string generate_id();
    void run_auth_session(const std::shared_ptr<AuthSession>& session);
};

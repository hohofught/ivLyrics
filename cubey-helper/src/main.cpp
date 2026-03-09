#include <httplib.h>
#include <nlohmann/json.hpp>
#include "cubey_api.h"
#include "session_store.h"
#include "auth_window.h"
#include "winhttp_client.h"

#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <atomic>
#include <csignal>
#include <algorithm>
#include <cctype>

static constexpr int DEFAULT_PORT = 15124;
static constexpr const char* BIND_HOST = "127.0.0.1";
static constexpr const char* VERSION = "0.1.0";
static constexpr const char* BLYRICS_URL = "https://lyrics-api.boidu.dev/getLyrics";
static constexpr const char* LEGATO_URL = "https://lyrics-api.boidu.dev/kugou/getLyrics";
static constexpr const char* LRCLIB_BASE = "https://lrclib.net/api";

// Allowed origins for CORS
static const std::vector<std::string> ALLOWED_ORIGINS = {
    "https://open.spotify.com",
    "https://xpui.app.spotify.com",
    "http://127.0.0.1",
    "http://localhost"
};

static std::atomic<bool> g_running{true};

void signal_handler(int) {
    g_running = false;
}

bool is_origin_allowed(const std::string& origin) {
    if (origin.empty()) return true; // non-browser clients

    auto normalize_origin = [](std::string value) {
        auto first = std::find_if_not(value.begin(), value.end(), [](unsigned char ch) {
            return std::isspace(ch) != 0;
        });
        value.erase(value.begin(), first);
        while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) {
            value.pop_back();
        }
        while (!value.empty() && value.back() == '/') {
            value.pop_back();
        }
        std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        return value;
    };

    auto has_allowed_local_origin = [](const std::string& value, const std::string& prefix) {
        if (value == prefix) return true;
        if (value.rfind(prefix + ":", 0) != 0) return false;

        const auto port = value.substr(prefix.size() + 1);
        return !port.empty() && std::all_of(port.begin(), port.end(), [](unsigned char ch) {
            return std::isdigit(ch) != 0;
        });
    };

    const auto normalized = normalize_origin(origin);
    for (const auto& allowed : ALLOWED_ORIGINS) {
        const auto normalized_allowed = normalize_origin(allowed);
        if (normalized == normalized_allowed) return true;
        if (normalized_allowed == "http://127.0.0.1" || normalized_allowed == "http://localhost") {
            if (has_allowed_local_origin(normalized, normalized_allowed)) return true;
        }
    }
    return false;
}

void set_cors_headers(httplib::Response& res, const std::string& origin) {
    std::string allow_origin = origin.empty() ? "*" : origin;
    while (!allow_origin.empty() && allow_origin.back() == '/') {
        allow_origin.pop_back();
    }
    res.set_header("Access-Control-Allow-Origin", allow_origin);
    if (!origin.empty()) {
        res.set_header("Vary", "Origin");
    }
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set_header("Access-Control-Max-Age", "86400");
}

void json_response(httplib::Response& res, int status, const nlohmann::json& body) {
    res.status = status;
    res.set_content(body.dump(), "application/json");
}

std::string trim_ascii(std::string value) {
    auto is_space = [](unsigned char ch) { return std::isspace(ch) != 0; };
    value.erase(value.begin(), std::find_if_not(value.begin(), value.end(), is_space));
    while (!value.empty() && is_space(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

std::string make_body_excerpt(const std::string& body) {
    if (body.empty()) return {};
    std::string excerpt;
    excerpt.reserve(std::min<size_t>(body.size(), 240));
    for (unsigned char ch : body) {
        if (excerpt.size() >= 240) break;
        excerpt.push_back(std::iscntrl(ch) && ch != '\t' ? ' ' : static_cast<char>(ch));
    }
    excerpt = trim_ascii(excerpt);
    if (body.size() > excerpt.size()) excerpt += "...";
    return excerpt;
}

bool is_probable_not_found_status(int status_code) {
    return status_code == 204 || status_code == 404 || status_code == 410;
}

bool is_probable_unavailable_status(int status_code) {
    return status_code == 401 || status_code == 403;
}

bool is_probable_empty_payload(const std::string& body) {
    const auto trimmed = trim_ascii(body);
    return trimmed.empty() || trimmed == "null" || trimmed == "{}" || trimmed == "[]";
}

std::string urlencode(const std::string& value) {
    std::ostringstream out;
    for (unsigned char ch : value) {
        if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
            out << ch;
        } else {
            out << '%' << std::uppercase << std::hex
                << static_cast<int>((ch >> 4) & 0x0F)
                << static_cast<int>(ch & 0x0F)
                << std::nouppercase << std::dec;
        }
    }
    return out.str();
}

std::string build_query_string(const httplib::Request& req, const std::vector<std::string>& keys) {
    std::ostringstream query;
    bool first = true;
    for (const auto& key : keys) {
        if (!req.has_param(key)) continue;
        if (!first) query << "&";
        first = false;
        query << key << "=" << urlencode(req.get_param_value(key));
    }
    return query.str();
}

void proxy_json_request(WinHttpClient& client,
                        const std::string& remote_url,
                        httplib::Response& res) {
    const auto upstream = client.get(remote_url, {{"Accept", "application/json"}}, 15000);
    if (!upstream.ok()) {
        if (is_probable_unavailable_status(upstream.status_code)) {
            json_response(res, 200, {
                {"success", true},
                {"data", nullptr},
                {"notAvailable", true},
                {"upstreamStatus", upstream.status_code},
                {"upstreamBodyExcerpt", make_body_excerpt(upstream.body)}
            });
            return;
        }
        if (is_probable_not_found_status(upstream.status_code) || is_probable_empty_payload(upstream.body)) {
            json_response(res, 200, {
                {"success", true},
                {"data", nullptr},
                {"notFound", true},
                {"upstreamStatus", upstream.status_code}
            });
            return;
        }
        json_response(res, 502, {
            {"success", false},
            {"error", "proxy_request_failed"},
            {"upstreamStatus", upstream.status_code},
            {"upstreamBodyExcerpt", make_body_excerpt(upstream.body)}
        });
        return;
    }

    if (is_probable_empty_payload(upstream.body)) {
        json_response(res, 200, {
            {"success", true},
            {"data", nullptr},
            {"notFound", true},
            {"upstreamStatus", upstream.status_code}
        });
        return;
    }

    try {
        auto data = nlohmann::json::parse(upstream.body);
        json_response(res, 200, {{"success", true}, {"data", data}});
    } catch (...) {
        json_response(res, 502, {
            {"success", false},
            {"error", "proxy_invalid_json"},
            {"upstreamStatus", upstream.status_code},
            {"upstreamBodyExcerpt", make_body_excerpt(upstream.body)}
        });
    }
}

int main(int argc, char* argv[]) {
    int port = DEFAULT_PORT;
    if (argc > 1) {
        int p = std::atoi(argv[1]);
        if (p > 0 && p < 65536) port = p;
    }

    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);

    SessionStore store;
    CubeyApi cubey(store);
    AuthWindowManager auth(cubey);
    WinHttpClient proxy_http;

    httplib::Server svr;

    // CORS preflight
    svr.Options(R"(.*)", [](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (is_origin_allowed(origin)) {
            set_cors_headers(res, origin);
        }
        res.status = 204;
    });

    // Health check
    svr.Get("/health", [](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);
        json_response(res, 200, {
            {"ok", true},
            {"version", VERSION}
        });
    });

    // Bootstrap: receive turnstile token, call Cubey verify-turnstile, store JWT
    svr.Post("/cubey/bootstrap", [&cubey](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        nlohmann::json body;
        try {
            body = nlohmann::json::parse(req.body);
        } catch (...) {
            json_response(res, 400, {{"error", "Invalid JSON body"}});
            return;
        }

        std::string turnstile_token = body.value("turnstileToken", "");
        std::string base_url = body.value("baseUrl", "https://lyrics.api.dacubeking.com");

        if (turnstile_token.empty()) {
            json_response(res, 400, {{"error", "Missing turnstileToken"}});
            return;
        }

        // Normalize base_url
        while (!base_url.empty() && base_url.back() == '/')
            base_url.pop_back();

        auto result = cubey.bootstrap(turnstile_token, base_url);

        if (!result.success) {
            nlohmann::json payload = {
                {"success", false},
                {"error", result.error}
            };
            if (result.upstream_status > 0) {
                payload["upstreamStatus"] = result.upstream_status;
            }
            if (!result.upstream_body_excerpt.empty()) {
                payload["upstreamBodyExcerpt"] = result.upstream_body_excerpt;
            }
            json_response(res, 502, payload);
            return;
        }

        json_response(res, 200, {
            {"success", true},
            {"sessionId", result.session_id},
            {"expiresAt", result.expires_at}
        });
    });

    svr.Post("/cubey/auth/start", [&auth](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        nlohmann::json body;
        try {
            body = nlohmann::json::parse(req.body);
        } catch (...) {
            json_response(res, 400, {{"error", "Invalid JSON body"}});
            return;
        }

        auto base_url = body.value("baseUrl", "https://lyrics.api.dacubeking.com");
        while (!base_url.empty() && base_url.back() == '/') {
            base_url.pop_back();
        }

        const auto status = auth.start(base_url);
        json_response(res, 200, {
            {"success", true},
            {"authId", status.auth_id},
            {"state", status.state}
        });
    });

    svr.Get("/cubey/auth/status", [&auth](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        const auto auth_id = req.get_param_value("authId");
        if (auth_id.empty()) {
            json_response(res, 400, {{"success", false}, {"error", "Missing authId"}});
            return;
        }

        const auto status = auth.get_status(auth_id);
        nlohmann::json payload = {
            {"success", status.state != "error"},
            {"state", status.state},
            {"authId", status.auth_id}
        };
        if (!status.session_id.empty()) payload["sessionId"] = status.session_id;
        if (status.expires_at > 0) payload["expiresAt"] = status.expires_at;
        if (!status.error.empty()) payload["error"] = status.error;
        if (status.upstream_status > 0) payload["upstreamStatus"] = status.upstream_status;
        if (!status.upstream_body_excerpt.empty()) payload["upstreamBodyExcerpt"] = status.upstream_body_excerpt;
        json_response(res, status.state == "error" ? 502 : 200, payload);
    });

    // Lyrics: use session to fetch from Cubey
    svr.Get("/cubey/lyrics", [&cubey](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        std::string session_id = req.get_param_value("sessionId");
        std::string song = req.get_param_value("song");
        std::string artist = req.get_param_value("artist");
        std::string album = req.get_param_value("album");
        std::string video_id = req.get_param_value("videoId");

        int duration = 0;
        auto dur_str = req.get_param_value("duration");
        if (!dur_str.empty()) {
            duration = std::atoi(dur_str.c_str());
        }

        if (session_id.empty()) {
            json_response(res, 400, {{"error", "Missing sessionId"}});
            return;
        }
        if (song.empty() || artist.empty()) {
            json_response(res, 400, {{"error", "Missing song or artist"}});
            return;
        }

        auto result = cubey.fetch_lyrics(session_id, song, artist, album, duration, video_id);

        if (result.reauth_required) {
            nlohmann::json payload = {
                {"success", false},
                {"error", result.error},
                {"reauthRequired", true}
            };
            if (result.upstream_status > 0) {
                payload["upstreamStatus"] = result.upstream_status;
            }
            if (!result.upstream_body_excerpt.empty()) {
                payload["upstreamBodyExcerpt"] = result.upstream_body_excerpt;
            }
            json_response(res, 401, payload);
            return;
        }

        if (!result.success) {
            nlohmann::json payload = {
                {"success", false},
                {"error", result.error}
            };
            if (result.upstream_status > 0) {
                payload["upstreamStatus"] = result.upstream_status;
            }
            if (!result.upstream_body_excerpt.empty()) {
                payload["upstreamBodyExcerpt"] = result.upstream_body_excerpt;
            }
            json_response(res, 502, payload);
            return;
        }

        json_response(res, 200, {
            {"success", true},
            {"data", result.data}
        });
    });

    svr.Get("/proxy/blyrics", [&proxy_http](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        const auto query = build_query_string(req, {"song", "artist", "album", "duration", "videoId", "s", "a", "al", "d"});
        if (query.empty()) {
            json_response(res, 400, {{"success", false}, {"error", "Missing query"}} );
            return;
        }
        proxy_json_request(proxy_http, std::string(BLYRICS_URL) + "?" + query, res);
    });

    svr.Get("/proxy/legato", [&proxy_http](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        const auto query = build_query_string(req, {"song", "artist", "album", "duration", "videoId", "s", "a", "al", "d"});
        if (query.empty()) {
            json_response(res, 400, {{"success", false}, {"error", "Missing query"}} );
            return;
        }
        proxy_json_request(proxy_http, std::string(LEGATO_URL) + "?" + query, res);
    });

    svr.Get("/proxy/lrclib", [&proxy_http](const httplib::Request& req, httplib::Response& res) {
        auto origin = req.get_header_value("Origin");
        if (!is_origin_allowed(origin)) {
            json_response(res, 403, {{"error", "Origin not allowed"}});
            return;
        }
        set_cors_headers(res, origin);

        const auto mode = req.has_param("mode") ? req.get_param_value("mode") : "get";
        if (mode != "get" && mode != "search") {
            json_response(res, 400, {{"success", false}, {"error", "Invalid mode"}});
            return;
        }

        std::vector<std::string> keys;
        if (mode == "get") {
            keys = {"track_name", "artist_name", "album_name", "duration"};
        } else {
            keys = {"track_name", "artist_name", "album_name", "duration", "q"};
        }
        const auto query = build_query_string(req, keys);
        if (query.empty()) {
            json_response(res, 400, {{"success", false}, {"error", "Missing query"}} );
            return;
        }
        proxy_json_request(proxy_http, std::string(LRCLIB_BASE) + "/" + mode + "?" + query, res);
    });

    // Session cleanup thread
    std::thread cleanup_thread([&store]() {
        while (g_running) {
            std::this_thread::sleep_for(std::chrono::seconds(60));
            store.cleanup_expired();
        }
    });
    cleanup_thread.detach();

    std::cout << "[cubey-helper] Starting on " << BIND_HOST << ":" << port << std::endl;
    std::cout << "[cubey-helper] Version " << VERSION << std::endl;

    if (!svr.listen(BIND_HOST, port)) {
        std::cerr << "[cubey-helper] Failed to bind to port " << port << std::endl;
        return 1;
    }

    return 0;
}

#include "cubey_api.h"
#include <sstream>
#include <vector>
#include <algorithm>
#include <cctype>
#include <iostream>

// Minimal base64 decode for JWT payload extraction
namespace {

static const std::string B64_CHARS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_decode(const std::string& encoded) {
    // Handle URL-safe base64
    std::string input = encoded;
    std::replace(input.begin(), input.end(), '-', '+');
    std::replace(input.begin(), input.end(), '_', '/');

    // Pad
    while (input.size() % 4 != 0)
        input.push_back('=');

    std::string decoded;
    decoded.reserve(input.size() * 3 / 4);

    std::vector<int> T(256, -1);
    for (int i = 0; i < 64; i++)
        T[(unsigned char)B64_CHARS[i]] = i;

    int val = 0, bits = -8;
    for (unsigned char c : input) {
        if (T[c] == -1) break;
        val = (val << 6) + T[c];
        bits += 6;
        if (bits >= 0) {
            decoded.push_back(char((val >> bits) & 0xFF));
            bits -= 8;
        }
    }
    return decoded;
}

std::string trim_ascii(std::string value) {
    auto is_space = [](unsigned char ch) { return std::isspace(ch) != 0; };
    value.erase(value.begin(), std::find_if_not(value.begin(), value.end(), is_space));
    while (!value.empty() && is_space(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

// Extract "name=value" from a Set-Cookie header value
// e.g. "sid=abc123; Path=/; HttpOnly" -> "sid=abc123"
std::string extract_cookie_pair(const std::string& set_cookie_value) {
    auto pos = set_cookie_value.find(';');
    std::string pair = (pos != std::string::npos)
        ? set_cookie_value.substr(0, pos)
        : set_cookie_value;
    return trim_ascii(pair);
}

// Build a "Cookie" header value from stored Set-Cookie headers
std::string build_cookie_header(const std::vector<std::string>& set_cookie_headers) {
    std::string result;
    for (const auto& sc : set_cookie_headers) {
        auto pair = extract_cookie_pair(sc);
        if (pair.empty()) continue;
        if (!result.empty()) result += "; ";
        result += pair;
    }
    return result;
}

std::string extract_cookie_name(const std::string& cookie_value) {
    const auto pair = extract_cookie_pair(cookie_value);
    const auto pos = pair.find('=');
    return trim_ascii(pos == std::string::npos ? pair : pair.substr(0, pos));
}

std::vector<std::string> merge_cookie_values(const std::vector<std::string>& base,
                                             const std::vector<std::string>& overlay) {
    std::vector<std::string> merged;
    auto upsert = [&merged](const std::string& cookie_value) {
        const auto name = extract_cookie_name(cookie_value);
        if (name.empty()) {
            return;
        }
        merged.erase(
            std::remove_if(merged.begin(), merged.end(), [&](const std::string& existing) {
                return extract_cookie_name(existing) == name;
            }),
            merged.end()
        );
        merged.push_back(cookie_value);
    };

    for (const auto& cookie : base) {
        upsert(cookie);
    }
    for (const auto& cookie : overlay) {
        upsert(cookie);
    }
    return merged;
}

} // namespace

CubeyApi::CubeyApi(SessionStore& store) : store_(store) {}

int64_t CubeyApi::decode_jwt_exp_ms(const std::string& jwt) {
    // Split by '.'
    auto dot1 = jwt.find('.');
    if (dot1 == std::string::npos) return 0;
    auto dot2 = jwt.find('.', dot1 + 1);
    if (dot2 == std::string::npos) return 0;

    std::string payload_b64 = jwt.substr(dot1 + 1, dot2 - dot1 - 1);
    std::string payload_json = base64_decode(payload_b64);

    try {
        auto j = nlohmann::json::parse(payload_json);
        if (j.contains("exp") && j["exp"].is_number()) {
            return static_cast<int64_t>(j["exp"].get<double>() * 1000.0);
        }
    } catch (...) {}

    return 0;
}

std::string CubeyApi::make_body_excerpt(const std::string& body) {
    if (body.empty()) return {};

    std::string excerpt;
    excerpt.reserve(std::min<size_t>(body.size(), 240));
    for (unsigned char ch : body) {
        if (excerpt.size() >= 240) break;
        excerpt.push_back(std::iscntrl(ch) && ch != '\t' ? ' ' : static_cast<char>(ch));
    }
    excerpt = trim_ascii(excerpt);
    if (body.size() > excerpt.size()) {
        excerpt += "...";
    }
    return excerpt;
}

std::string CubeyApi::verify_turnstile(const std::string& base_url,
                                        const std::string& turnstile_token,
                                        int* upstream_status,
                                        std::string* upstream_body_excerpt,
                                        std::vector<std::string>* out_cookies,
                                        const std::vector<std::string>& challenge_cookies) {
    std::string endpoint = base_url + "/verify-turnstile";
    nlohmann::json req_body;
    req_body["token"] = turnstile_token;

    std::map<std::string, std::string> headers;
    if (!challenge_cookies.empty()) {
        const auto cookie_header = build_cookie_header(challenge_cookies);
        if (!cookie_header.empty()) {
            headers["Cookie"] = cookie_header;
            std::cerr << "[cubey-helper] verify-turnstile injecting "
                      << challenge_cookies.size() << " challenge cookie(s)"
                      << std::endl;
        }
    }

    auto resp = http_.post(endpoint, req_body.dump(), "application/json", headers, 15000);
    if (upstream_status) {
        *upstream_status = resp.status_code;
    }
    if (upstream_body_excerpt) {
        *upstream_body_excerpt = make_body_excerpt(resp.body);
    }
    if (out_cookies) {
        *out_cookies = resp.set_cookie_headers;
    }

    if (!resp.ok()) {
        std::cerr << "[cubey-helper] verify-turnstile failed"
                  << " status=" << resp.status_code
                  << " error=" << resp.error
                  << " body=" << make_body_excerpt(resp.body)
                  << std::endl;
        return "";
    }

    if (!resp.set_cookie_headers.empty()) {
        std::cerr << "[cubey-helper] verify-turnstile received "
                  << resp.set_cookie_headers.size() << " Set-Cookie header(s)"
                  << std::endl;
    }

    try {
        auto j = nlohmann::json::parse(resp.body);
        // Try multiple response shapes
        if (j.contains("jwt") && j["jwt"].is_string())
            return j["jwt"].get<std::string>();
        if (j.contains("token") && j["token"].is_string())
            return j["token"].get<std::string>();
        if (j.contains("data")) {
            auto& d = j["data"];
            if (d.contains("jwt") && d["jwt"].is_string())
                return d["jwt"].get<std::string>();
            if (d.contains("token") && d["token"].is_string())
                return d["token"].get<std::string>();
        }
    } catch (...) {}

    return "";
}

BootstrapResult CubeyApi::bootstrap(const std::string& turnstile_token,
                                     const std::string& base_url,
                                     const std::vector<std::string>& challenge_cookies) {
    std::lock_guard<std::mutex> lk(mu_);
    BootstrapResult result;

    if (turnstile_token.empty() || base_url.empty()) {
        result.error = "Missing turnstile_token or base_url";
        return result;
    }

    std::vector<std::string> cookies;
    std::string jwt = verify_turnstile(
        base_url,
        turnstile_token,
        &result.upstream_status,
        &result.upstream_body_excerpt,
        &cookies,
        challenge_cookies
    );
    if (jwt.empty()) {
        result.error = result.upstream_status > 0
            ? "verify-turnstile failed: HTTP " + std::to_string(result.upstream_status)
            : "verify-turnstile failed or returned empty JWT";
        return result;
    }

    int64_t exp_ms = decode_jwt_exp_ms(jwt);
    const auto session_cookies = merge_cookie_values(challenge_cookies, cookies);
    if (!session_cookies.empty()) {
        std::cerr << "[cubey-helper] bootstrap storing "
                  << session_cookies.size() << " upstream cookie(s)"
                  << std::endl;
    }
    std::string sid = store_.create(jwt, base_url, exp_ms, session_cookies);

    result.success = true;
    result.session_id = sid;
    result.expires_at = exp_ms;
    return result;
}

LyricsResult CubeyApi::fetch_lyrics(const std::string& session_id,
                                     const std::string& song,
                                     const std::string& artist,
                                     const std::string& album,
                                     int duration_seconds,
                                     const std::string& video_id) {
    LyricsResult result;

    auto session_opt = store_.get(session_id);
    if (!session_opt.has_value()) {
        result.error = "Invalid or expired session";
        result.reauth_required = true;
        return result;
    }

    auto& session = session_opt.value();
    if (!store_.is_jwt_usable(session)) {
        store_.invalidate(session_id);
        result.error = "JWT expired";
        result.reauth_required = true;
        return result;
    }

    // Build URL
    std::ostringstream url;
    url << session.base_url << "/lyrics";

    // URL-encode helper (simple)
    auto urlencode = [](const std::string& s) -> std::string {
        std::ostringstream encoded;
        for (unsigned char c : s) {
            if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
                encoded << c;
            } else {
                encoded << '%' << std::uppercase << std::hex
                        << ((c >> 4) & 0x0F) << (c & 0x0F);
            }
        }
        return encoded.str();
    };

    url << "?song=" << urlencode(song);
    url << "&artist=" << urlencode(artist);
    if (!album.empty()) {
        url << "&album=" << urlencode(album);
    }
    if (duration_seconds > 0) {
        url << "&duration=" << duration_seconds;
    }
    if (!video_id.empty()) {
        url << "&videoId=" << urlencode(video_id);
    }
    url << "&alwaysFetchMetadata=true";

    std::map<std::string, std::string> headers;
    headers["Authorization"] = "Bearer " + session.jwt;

    // Re-inject cookies captured from verify-turnstile
    if (!session.upstream_cookies.empty()) {
        std::string cookie_header = build_cookie_header(session.upstream_cookies);
        if (!cookie_header.empty()) {
            headers["Cookie"] = cookie_header;
            std::cerr << "[cubey-helper] lyrics injecting Cookie header: "
                      << cookie_header.substr(0, 80)
                      << (cookie_header.size() > 80 ? "..." : "")
                      << std::endl;
        }
    }

    auto resp = http_.get(url.str(), headers, 15000);
    result.upstream_status = resp.status_code;
    result.upstream_body_excerpt = make_body_excerpt(resp.body);

    if (resp.status_code == 401 || resp.status_code == 403) {
        store_.invalidate(session_id);
        result.error = "Cubey returned " + std::to_string(resp.status_code);
        result.reauth_required = true;
        std::cerr << "[cubey-helper] lyrics reauth required"
                  << " status=" << resp.status_code
                  << " body=" << result.upstream_body_excerpt
                  << std::endl;
        return result;
    }

    if (!resp.error.empty()) {
        result.error = "Cubey lyrics request failed: " + resp.error;
        std::cerr << "[cubey-helper] lyrics transport failure"
                  << " error=" << resp.error
                  << std::endl;
        return result;
    }

    if (!resp.ok()) {
        result.error = "Cubey lyrics request failed: HTTP " + std::to_string(resp.status_code);
        std::cerr << "[cubey-helper] lyrics upstream failure"
                  << " status=" << resp.status_code
                  << " body=" << result.upstream_body_excerpt
                  << std::endl;
        return result;
    }

    try {
        result.data = nlohmann::json::parse(resp.body);
        result.success = true;
    } catch (const std::exception& e) {
        result.error = std::string("JSON parse error: ") + e.what();
        std::cerr << "[cubey-helper] lyrics parse failure"
                  << " body=" << result.upstream_body_excerpt
                  << std::endl;
    }

    return result;
}

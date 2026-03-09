cmake_minimum_required(VERSION 3.20)
project(cubey-helper VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Static CRT linkage for single-exe deployment
if(MSVC)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    add_compile_options(/W4 /utf-8)
    # LTO for release
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION_RELEASE ON)
endif()

# Download header-only dependencies if not present
include(FetchContent)

FetchContent_Declare(
    httplib
    GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
    GIT_TAG v0.18.3
)
FetchContent_MakeAvailable(httplib)

FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(json)

add_executable(cubey-helper
    src/main.cpp
    src/auth_window.cpp
    src/winhttp_client.cpp
    src/session_store.cpp
    src/cubey_api.cpp
)

target_include_directories(cubey-helper PRIVATE include)
target_link_libraries(cubey-helper PRIVATE httplib::httplib nlohmann_json::nlohmann_json)

# WinHTTP for HTTPS client
target_link_libraries(cubey-helper PRIVATE winhttp ole32)

set(IVLYRICS_WEBVIEW2_VERSION "1.0.3719.77" CACHE STRING "Preferred WebView2 SDK version")

function(ivlyrics_resolve_webview2_root out_var)
    set(search_roots)
    if(DEFINED ENV{NUGET_PACKAGES} AND NOT "$ENV{NUGET_PACKAGES}" STREQUAL "")
        list(APPEND search_roots "$ENV{NUGET_PACKAGES}")
    endif()
    if(DEFINED ENV{USERPROFILE} AND NOT "$ENV{USERPROFILE}" STREQUAL "")
        list(APPEND search_roots "$ENV{USERPROFILE}/.nuget/packages")
    endif()

    foreach(packages_root IN LISTS search_roots)
        file(GLOB package_dirs "${packages_root}/microsoft.web.webview2/*")
        if(package_dirs)
            list(SORT package_dirs COMPARE NATURAL ORDER ASCENDING)
            list(REVERSE package_dirs)
            list(GET package_dirs 0 candidate_root)
            if(EXISTS "${candidate_root}/build/native/include/WebView2.h")
                set(${out_var} "${candidate_root}" PARENT_SCOPE)
                return()
            endif()
        endif()
    endforeach()

    set(download_root "${CMAKE_BINARY_DIR}/_deps/webview2")
    set(nupkg_path "${download_root}/Microsoft.Web.WebView2.${IVLYRICS_WEBVIEW2_VERSION}.nupkg")
    set(extract_root "${download_root}/pkg")
    set(header_path "${extract_root}/build/native/include/WebView2.h")

    if(NOT EXISTS "${header_path}")
        file(MAKE_DIRECTORY "${download_root}")
        message(STATUS "Downloading WebView2 SDK ${IVLYRICS_WEBVIEW2_VERSION} to ${download_root}")
        file(
            DOWNLOAD
            "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${IVLYRICS_WEBVIEW2_VERSION}"
            "${nupkg_path}"
            STATUS download_status
            LOG download_log
            SHOW_PROGRESS
            TLS_VERIFY ON
        )
        list(GET download_status 0 download_code)
        if(NOT download_code EQUAL 0)
            message(WARNING "Failed to download WebView2 SDK: ${download_status}")
            message(STATUS "WebView2 download log: ${download_log}")
            return()
        endif()
        file(REMOVE_RECURSE "${extract_root}")
        file(ARCHIVE_EXTRACT INPUT "${nupkg_path}" DESTINATION "${extract_root}")
    endif()

    if(EXISTS "${header_path}")
        set(${out_var} "${extract_root}" PARENT_SCOPE)
    endif()
endfunction()

if (CMAKE_SIZEOF_VOID_P EQUAL 8)
    set(WEBVIEW2_ARCH x64)
else()
    set(WEBVIEW2_ARCH x86)
endif()

ivlyrics_resolve_webview2_root(WEBVIEW2_ROOT)

if (WEBVIEW2_ROOT)
    set(WEBVIEW2_INCLUDE_DIR "${WEBVIEW2_ROOT}/build/native/include")
    set(WEBVIEW2_STATIC_LIB "${WEBVIEW2_ROOT}/build/native/${WEBVIEW2_ARCH}/WebView2LoaderStatic.lib")
    if (EXISTS "${WEBVIEW2_INCLUDE_DIR}/WebView2.h" AND EXISTS "${WEBVIEW2_STATIC_LIB}")
        target_include_directories(cubey-helper PRIVATE "${WEBVIEW2_INCLUDE_DIR}")
        target_link_libraries(cubey-helper PRIVATE "${WEBVIEW2_STATIC_LIB}")
        target_compile_definitions(cubey-helper PRIVATE IVLYRICS_HAS_WEBVIEW2=1)
        message(STATUS "WebView2 SDK enabled from ${WEBVIEW2_ROOT}")
    else()
        target_compile_definitions(cubey-helper PRIVATE IVLYRICS_HAS_WEBVIEW2=0)
        message(WARNING "WebView2 SDK layout incomplete under ${WEBVIEW2_ROOT}; embedded auth window will be disabled.")
    endif()
else()
    target_compile_definitions(cubey-helper PRIVATE IVLYRICS_HAS_WEBVIEW2=0)
    message(WARNING "WebView2 SDK not found; cubey-helper will build without embedded auth window support.")
endif()

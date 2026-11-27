//! Localhost-only authenticated proxy for in-game CreditGuardRuntime requests.
//! Reuses the Desktop Hub's existing DPAPI-protected XingShu account session so players
//! never have to sign in a second time inside the game (and never get kicked out of the game).
//! Raw account tokens never leave the Hub process and are never written to discovery files.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const REMOTE_ORIGIN: &str = "https://124.221.176.134";
const MAX_REQUEST_BYTES: usize = 72 * 1024;
const MAX_RESPONSE_BYTES: usize = 512 * 1024;

fn discovery_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("XingShu-Hub").join("credit-proxy.json"))
}

fn write_discovery_file(port: u16, nonce: &str) {
    let Some(path) = discovery_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = json!({
        "port": port,
        "nonce": nonce,
        "pid": std::process::id(),
    });
    if let Ok(bytes) = serde_json::to_vec(&payload) {
        if let Some(parent) = path.parent() {
            if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(parent) {
                use std::io::Write;
                if tmp.write_all(&bytes).and_then(|_| tmp.as_file().sync_all()).is_ok() {
                    let _ = tmp.persist(&path);
                    return;
                }
            }
        }
        let _ = std::fs::write(&path, bytes);
    }
}

fn is_allowed_credit_path(path: &str) -> bool {
    if !path.starts_with("/api/credit/") {
        return false;
    }
    if path.len() > 256
        || path.contains("..")
        || path.contains("//")
        || path.contains('\\')
        || path.bytes().any(|b| b <= 0x20 || b == 0x7f)
    {
        return false;
    }
    true
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in ab.iter().zip(bb.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn parse_http_request(raw: &[u8]) -> Option<(String, String, Vec<(String, String)>, Vec<u8>)> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let header_str = std::str::from_utf8(&raw[..split]).ok()?;
    let mut lines = header_str.split("\r\n");
    let first = lines.next()?;
    let mut parts = first.split_whitespace();
    let method = parts.next()?.to_ascii_uppercase();
    let path = parts.next()?.to_string();
    let mut headers = Vec::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    let body = raw[split + 4..].to_vec();
    Some((method, path, headers, body))
}

async fn read_full_http_request(stream: &mut TcpStream) -> Option<(String, String, Vec<(String, String)>, Vec<u8>)> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let mut header_end: Option<usize> = None;
    let mut content_length: usize = 0;

    loop {
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut chunk))
            .await
            .ok()?
            .ok()?;
        if n == 0 {
            break;
        }
        if buf.len() + n > MAX_REQUEST_BYTES {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if header_end.is_none() {
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                header_end = Some(pos + 4);
                if let Ok(hstr) = std::str::from_utf8(&buf[..pos]) {
                    for line in hstr.split("\r\n").skip(1) {
                        if let Some((k, v)) = line.split_once(':') {
                            if k.trim().eq_ignore_ascii_case("content-length") {
                                content_length = v.trim().parse::<usize>().unwrap_or(0);
                            }
                        }
                    }
                }
                if pos + 4 + content_length > MAX_REQUEST_BYTES {
                    return None;
                }
            }
        }
        if let Some(end) = header_end {
            if buf.len() >= end + content_length {
                buf.truncate(end + content_length);
                break;
            }
        }
    }
    parse_http_request(&buf)
}

async fn write_json_response(stream: &mut TcpStream, status: u16, reason: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes()).await;
    let _ = stream.write_all(body).await;
    let _ = stream.shutdown().await;
}

async fn handle_connection<F>(
    mut stream: TcpStream,
    peer: SocketAddr,
    nonce: Arc<String>,
    token_provider: Arc<F>,
    http_client: reqwest::Client,
) where
    F: Fn() -> Option<String> + Send + Sync + ?Sized + 'static,
{
    if !peer.ip().is_loopback() {
        return;
    }
    let Some((method, path, headers, body)) = read_full_http_request(&mut stream).await else {
        write_json_response(&mut stream, 400, "Bad Request", br#"{"error":"Invalid request"}"#).await;
        return;
    };

    let provided_nonce = headers
        .iter()
        .find(|(k, _)| k == "x-xingshu-proxy-nonce")
        .map(|(_, v)| v.as_str())
        .unwrap_or("");
    if !constant_time_eq(provided_nonce, nonce.as_str()) {
        write_json_response(&mut stream, 403, "Forbidden", br#"{"error":"Unauthorized proxy caller"}"#).await;
        return;
    }

    if method == "GET" && path == "/_status" {
        let signed_in = token_provider().is_some();
        let out = json!({ "ok": true, "signedIn": signed_in }).to_string();
        write_json_response(&mut stream, 200, "OK", out.as_bytes()).await;
        return;
    }

    if !matches!(method.as_str(), "GET" | "POST" | "DELETE") || !is_allowed_credit_path(&path) {
        write_json_response(&mut stream, 403, "Forbidden", br#"{"error":"Route not permitted"}"#).await;
        return;
    }

    let url = format!("{REMOTE_ORIGIN}{path}");
    let mut req = match method.as_str() {
        "GET" => http_client.get(&url),
        "POST" => http_client.post(&url),
        "DELETE" => http_client.delete(&url),
        _ => return,
    };
    req = req
        .header("Origin", REMOTE_ORIGIN)
        .header("Content-Type", "application/json; charset=utf-8");
    if let Some(tok) = token_provider() {
        req = req.bearer_auth(tok);
    }
    if !body.is_empty() {
        req = req.body(body);
    }

    match req.send().await {
        Ok(mut resp) => {
            let status = resp.status();
            let mut out = Vec::new();
            while let Ok(Some(chunk)) = resp.chunk().await {
                if out.len() + chunk.len() > MAX_RESPONSE_BYTES {
                    write_json_response(&mut stream, 502, "Bad Gateway", br#"{"error":"Upstream response too large"}"#).await;
                    return;
                }
                out.extend_from_slice(&chunk);
            }
            if out.is_empty() {
                out.extend_from_slice(b"{}");
            }
            let reason = status.canonical_reason().unwrap_or("OK");
            write_json_response(&mut stream, status.as_u16(), reason, &out).await;
        }
        Err(_) => {
            write_json_response(
                &mut stream,
                502,
                "Bad Gateway",
                r#"{"error":"星枢社区服务连接失败，请稍后重试"}"#.as_bytes(),
            )
            .await;
        }
    }
}

pub fn start_credit_proxy(app: tauri::AppHandle) {
    let nonce = Arc::new(format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    ));
    let token_provider: Arc<dyn Fn() -> Option<String> + Send + Sync> = {
        let handle = app.clone();
        Arc::new(move || crate::account_login::current_session_token(&handle))
    };
    let nonce_clone = nonce.clone();

    tauri::async_runtime::spawn(async move {
        let Ok(listener) = TcpListener::bind("127.0.0.1:0").await else {
            tracing::warn!("Failed to bind local credit proxy on 127.0.0.1");
            return;
        };
        let Ok(local_addr) = listener.local_addr() else {
            return;
        };
        write_discovery_file(local_addr.port(), &nonce_clone);
        tracing::info!(port = local_addr.port(), "XingShu local credit proxy listening on 127.0.0.1");

        let Ok(http_client) = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        else {
            return;
        };

        loop {
            match listener.accept().await {
                Ok((stream, peer)) => {
                    let n = nonce_clone.clone();
                    let tp = token_provider.clone();
                    let hc = http_client.clone();
                    tokio::spawn(async move {
                        handle_connection(stream, peer, n, tp, hc).await;
                    });
                }
                Err(_) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credit_proxy_path_guard_blocks_non_credit_and_traversal() {
        assert!(is_allowed_credit_path("/api/credit/profiles"));
        assert!(is_allowed_credit_path("/api/credit/fleet/rooms/12345/join-ticket"));
        assert!(is_allowed_credit_path("/api/credit/fleet/follow/1556514?lastRoomId=99"));
        assert!(!is_allowed_credit_path("/api/admin/credit/reports"));
        assert!(!is_allowed_credit_path("/api/credit/../admin/overview"));
        assert!(!is_allowed_credit_path("/auth/me"));
        assert!(!is_allowed_credit_path("/api/credit/foo\\bar"));
    }

    #[tokio::test]
    async fn credit_proxy_status_requires_nonce_and_reports_signed_in_state() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let nonce = Arc::new("test-nonce-123456".to_string());
        let tp = Arc::new(|| Some("fake-token-never-returned".to_string()));
        let hc = reqwest::Client::new();

        let n_bg = nonce.clone();
        let srv = tokio::spawn(async move {
            for _ in 0..2 {
                let (stream, peer) = listener.accept().await.unwrap();
                handle_connection(stream, peer, n_bg.clone(), tp.clone(), hc.clone()).await;
            }
        });

        // Wrong nonce -> 403
        let mut s1 = TcpStream::connect(addr).await.unwrap();
        s1.write_all(b"GET /_status HTTP/1.1\r\nHost: 127.0.0.1\r\nX-XingShu-Proxy-Nonce: wrong\r\n\r\n")
            .await
            .unwrap();
        let mut r1 = String::new();
        s1.read_to_string(&mut r1).await.unwrap();
        assert!(r1.starts_with("HTTP/1.1 403"));
        assert!(!r1.contains("fake-token"));

        // Valid nonce -> 200 signedIn:true without leaking token
        let mut s2 = TcpStream::connect(addr).await.unwrap();
        s2.write_all(b"GET /_status HTTP/1.1\r\nHost: 127.0.0.1\r\nX-XingShu-Proxy-Nonce: test-nonce-123456\r\n\r\n")
            .await
            .unwrap();
        let mut r2 = String::new();
        s2.read_to_string(&mut r2).await.unwrap();
        assert!(r2.starts_with("HTTP/1.1 200"));
        assert!(r2.contains("\"signedIn\":true"));
        assert!(!r2.contains("fake-token"));

        srv.await.unwrap();
    }
}

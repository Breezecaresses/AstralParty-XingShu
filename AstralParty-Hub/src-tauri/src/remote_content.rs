use std::time::{Duration, Instant};

use crate::domain::error::{HubError, HubResult};

pub const ORIGIN: &str = "https://astralparty-xingshu.lanxichaxu.cn";

pub fn client() -> HubResult<reqwest::Client> {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| network_error("无法初始化星枢下载服务。"))
}

pub fn network_error(message: impl Into<String>) -> HubError {
    HubError::new("REMOTE_CONTENT", message, "DOWNLOAD").with_recoverable(true)
}

pub async fn read(client: &reqwest::Client, path: &str, limit: usize) -> HubResult<Vec<u8>> {
    read_with_progress(client, path, limit, |_, _| {}).await
}

pub async fn read_with_progress<F>(
    client: &reqwest::Client,
    path: &str,
    limit: usize,
    mut on_progress: F,
) -> HubResult<Vec<u8>>
where
    F: FnMut(u64, Option<u64>),
{
    if !path.starts_with('/') || path.split('/').any(|part| part == ".." || part == ".")
        || path.starts_with("//") || !path.bytes().all(|c| c.is_ascii_alphanumeric() || b"/._-".contains(&c))
    {
        return Err(HubError::security_violation("星枢下载路径无效。"));
    }

    let mut response = client.get(format!("{ORIGIN}{path}")).send().await
        .map_err(|_| network_error("无法连接星枢服务器，请检查网络后重试。"))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(network_error(format!("星枢下载返回 HTTP {}。", response.status().as_u16())));
    }
    let content_length = response.content_length();
    if content_length.is_some_and(|len| len > limit as u64) {
        return Err(HubError::security_violation("下载文件超过体积上限。"));
    }
    on_progress(0, content_length);
    let mut data = Vec::new();
    let mut last_emit_at = Instant::now();
    let mut last_emit_bytes = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(|_| network_error("下载中断，请重试。"))? {
        if chunk.len() > limit.saturating_sub(data.len()) {
            return Err(HubError::security_violation("下载文件超过体积上限。"));
        }
        data.extend_from_slice(&chunk);
        let downloaded = data.len() as u64;
        if downloaded.saturating_sub(last_emit_bytes) >= 64 * 1024
            || last_emit_at.elapsed() >= Duration::from_millis(80)
        {
            last_emit_bytes = downloaded;
            last_emit_at = Instant::now();
            on_progress(downloaded, content_length);
        }
    }
    if data.is_empty() {
        return Err(network_error("星枢服务器返回了空文件。"));
    }
    let final_total = content_length.or(Some(data.len() as u64));
    on_progress(data.len() as u64, final_total);
    Ok(data)
}

#[allow(dead_code)]
pub async fn verified(
    client: &reqwest::Client, path: &str, digest: &str, size: u64, limit: usize,
) -> HubResult<Vec<u8>> {
    verified_with_progress(client, path, digest, size, limit, |_, _| {}).await
}

pub async fn verified_with_progress<F>(
    client: &reqwest::Client,
    path: &str,
    digest: &str,
    size: u64,
    limit: usize,
    mut on_progress: F,
) -> HubResult<Vec<u8>>
where
    F: FnMut(u64, u64),
{
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit())
        || size == 0 || size > limit as u64
    {
        return Err(HubError::security_violation("下载清单缺少有效的大小或 SHA-256。"));
    }
    let data = read_with_progress(client, path, size as usize, |dl, _| on_progress(dl, size)).await?;
    if data.len() as u64 != size || !crate::security::hash::compute_sha256_bytes(&data).eq_ignore_ascii_case(digest) {
        return Err(HubError::security_violation("下载文件与清单的大小或 SHA-256 不一致。"));
    }
    Ok(data)
}

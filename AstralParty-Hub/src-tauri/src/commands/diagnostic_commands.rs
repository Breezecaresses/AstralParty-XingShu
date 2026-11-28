use crate::desktop_host::State;
use crate::application::DiagnosticService;
use crate::diagnostics::report::DiagnosticReport;
use crate::domain::error::{HubError, HubResult};
use crate::providers::orchestrator::ProviderOrchestrator;
use crate::providers::provider::{ProbeResult, ProviderContext, ProviderMetadata};

#[cfg_attr(feature = "web-ui", tauri::command)]
pub async fn get_diagnostic_report(
    diagnostic_service: State<'_, DiagnosticService>,
) -> HubResult<DiagnosticReport> {
    let svc = diagnostic_service.inner().clone();
    tokio::task::spawn_blocking(move || svc.generate_report())
        .await
        .map_err(|e| HubError::new("DIAGNOSTIC_FAILED", e.to_string(), "DIAGNOSTIC"))?
}

#[cfg_attr(feature = "web-ui", tauri::command)]
pub async fn list_providers(
    orchestrator: State<'_, ProviderOrchestrator>,
) -> HubResult<Vec<ProviderMetadata>> {
    Ok(orchestrator.list_providers())
}

#[cfg_attr(feature = "web-ui", tauri::command)]
pub async fn probe_providers(
    orchestrator: State<'_, ProviderOrchestrator>,
) -> HubResult<Vec<(ProviderMetadata, ProbeResult)>> {
    let ctx = ProviderContext {
        game_root: None,
        profile_id: None,
    };
    Ok(orchestrator.probe_all(&ctx).await)
}

#[cfg_attr(feature = "web-ui", tauri::command)]
pub async fn sync_provider_data(
    provider_id: String,
    orchestrator: State<'_, ProviderOrchestrator>,
) -> HubResult<usize> {
    let ctx = ProviderContext {
        game_root: None,
        profile_id: None,
    };
    orchestrator.sync_provider(&provider_id, &ctx).await
}

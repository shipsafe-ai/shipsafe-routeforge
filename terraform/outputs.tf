output "cloud_run_url" {
  value       = google_cloud_run_v2_service.routeforge.uri
  description = "Cloud Run service URL — use as GitLab webhook URL"
}

output "mcp_gitlab_url" {
  value       = google_cloud_run_v2_service.mcp_gitlab.uri
  description = "zereight/gitlab-mcp Cloud Run URL"
}

output "service_account_email" {
  value = google_service_account.routeforge.email
}

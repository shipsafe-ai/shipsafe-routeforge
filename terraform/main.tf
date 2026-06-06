terraform {
  required_version = ">= 1.8"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
  }
  backend "gcs" {
    bucket = "shipsafe-routeforge-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# -----------------------------------------------------------------------
# Artifact Registry
# -----------------------------------------------------------------------
resource "google_artifact_registry_repository" "routeforge" {
  location      = var.region
  repository_id = "routeforge"
  format        = "DOCKER"
}

# -----------------------------------------------------------------------
# Secret Manager (values managed outside Terraform)
# -----------------------------------------------------------------------
resource "google_secret_manager_secret" "gitlab_pat" {
  secret_id = "GITLAB_PAT"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "gitlab_webhook_secret" {
  secret_id = "GITLAB_WEBHOOK_SECRET"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "gitlab_mcp_oauth_token" {
  secret_id = "GITLAB_MCP_OAUTH_TOKEN"
  replication {
    auto {}
  }
}

# -----------------------------------------------------------------------
# Service Account
# -----------------------------------------------------------------------
resource "google_service_account" "routeforge" {
  account_id   = "routeforge-agent"
  display_name = "RouteForge Agent Service Account"
}

resource "google_project_iam_member" "routeforge_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.routeforge.email}"
}

resource "google_secret_manager_secret_iam_member" "pat_access" {
  secret_id = google_secret_manager_secret.gitlab_pat.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.routeforge.email}"
}

resource "google_secret_manager_secret_iam_member" "webhook_access" {
  secret_id = google_secret_manager_secret.gitlab_webhook_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.routeforge.email}"
}

resource "google_secret_manager_secret_iam_member" "mcp_oauth_access" {
  secret_id = google_secret_manager_secret.gitlab_mcp_oauth_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.routeforge.email}"
}

# -----------------------------------------------------------------------
# Cloud Run service
# -----------------------------------------------------------------------
resource "google_cloud_run_v2_service" "routeforge" {
  name     = "routeforge"
  location = var.region

  template {
    service_account = google_service_account.routeforge.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/routeforge/agent:${var.image_tag}"

      ports {
        container_port = 8080
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "VERTEX_LOCATION"
        value = var.region
      }
      env {
        name  = "GITLAB_PROJECT_ID"
        value = var.gitlab_project_id
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# Public ingress so GitLab can POST webhooks
resource "google_cloud_run_service_iam_member" "public_invoker" {
  location = var.region
  service  = google_cloud_run_v2_service.routeforge.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# -----------------------------------------------------------------------
# zereight/gitlab-mcp — community MCP server (PAT + remote auth)
# -----------------------------------------------------------------------
resource "google_cloud_run_v2_service" "mcp_gitlab" {
  name     = "routeforge-mcp"
  location = var.region

  template {
    service_account = google_service_account.routeforge.email

    containers {
      image = "zereight050/gitlab-mcp:latest"

      ports {
        container_port = 3002
      }

      env {
        name  = "STREAMABLE_HTTP"
        value = "true"
      }
      env {
        name  = "REMOTE_AUTHORIZATION"
        value = "true"
      }
      env {
        name  = "GITLAB_API_URL"
        value = "https://gitlab.com/api/v4"
      }
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "USE_PIPELINE"
        value = "true"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
  }

  traffic {
    percent = 100
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

resource "google_cloud_run_service_iam_member" "mcp_public_invoker" {
  location = var.region
  service  = google_cloud_run_v2_service.mcp_gitlab.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

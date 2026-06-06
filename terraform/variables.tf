variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "GCP region for Cloud Run and Artifact Registry"
}

variable "gitlab_project_id" {
  type        = string
  default     = "82762386"
  description = "GitLab project ID for shipsafe/routing-engine"
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Docker image tag to deploy"
}

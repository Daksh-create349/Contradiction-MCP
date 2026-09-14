# UserAuthService Operations Runbook

This runbook defines the runtime requirements, deployment profile, and operational thresholds for the UserAuthService cluster.

## Runtime Requirements

- service_name: UserAuthService
- node_version: 18.19.0
- min_ram: 8GB
- http_port: 8080
- database_engine: PostgreSQL 14
- timeout_ms: 15000
- max_connections: 5000
- jwt_expiry_seconds: 3600
- tls_enabled: true

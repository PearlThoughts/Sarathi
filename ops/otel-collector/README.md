# Sarathi OpenTelemetry Collector

This stateless service receives OTLP from Sarathi over Railway private networking, applies memory limits, strips forbidden attributes, keeps failed and slow traces, samples fast successful traces, batches, retries, and exports to the configured Better Stack telemetry source.

## Runtime contract

- Application endpoint: `http://<collector-private-host>:4318`
- Collector health: `http://<collector-private-host>:13133/`
- Required protected variables: `BETTERSTACK_OTLP_ENDPOINT`, `BETTERSTACK_SOURCE_TOKEN`
- Application protected variable: `SARATHI_OTLP_ENDPOINT`
- Direct-export fallback only: `SARATHI_OTLP_AUTHORIZATION`

The application must use the collector private endpoint without a Better Stack token. The collector alone owns the telemetry source token. Direct export is an explicit fallback and must not be enabled simultaneously.

The collector is not a synchronous dependency. The application SDK uses bounded batch queues and short export timeouts; collector or exporter failure may drop telemetry but cannot fail a report.

FROM otel/opentelemetry-collector-contrib:0.158.0

COPY collector.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 4317 4318 13133

ENTRYPOINT ["/otelcol-contrib"]
CMD ["--config=/etc/otelcol-contrib/config.yaml"]

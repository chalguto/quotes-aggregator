export default () => ({
  server: {
    port: parseInt(process.env.PORT ?? '3000', 10),
    env: process.env.NODE_ENV ?? 'development',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    jwtIssuer: process.env.JWT_ISSUER ?? 'quotes-aggregator',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'quotes-api',
    devApiToken: process.env.DEV_API_TOKEN ?? '',
  },
  idempotency: {
    ttlSeconds: parseInt(process.env.IDEMPOTENCY_TTL ?? '86400', 10),
  },
  circuitBreaker: {
    timeout: parseInt(process.env.CB_TIMEOUT ?? '3000', 10),
    errorThresholdPercentage: parseInt(process.env.CB_ERROR_THRESHOLD ?? '50', 10),
    resetTimeout: parseInt(process.env.CB_RESET_TIMEOUT ?? '30000', 10),
    volumeThreshold: parseInt(process.env.CB_VOLUME_THRESHOLD ?? '5', 10),
  },
  serviceBus: {
    connectionString: process.env.SERVICE_BUS_CONNECTION_STRING ?? null,
    namespace: process.env.SERVICE_BUS_NAMESPACE ?? null,
    topicName: process.env.SERVICE_BUS_TOPIC_NAME ?? 'quotes.issued',
  },
});

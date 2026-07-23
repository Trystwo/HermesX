/**
 * 配置对象 - 从环境变量读取
 * 注意: ConfigModule.forRoot({ isGlobal: true }) 在 app.module.ts 中配置
 */
export const configuration = () => {
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
  const dbName = process.env.DB_NAME || 'hermesx';
  const dbUser = process.env.DB_USER || 'hermesx';
  const dbPassword = process.env.DB_PASSWORD || 'hermesx_dev_2026';

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    environment: process.env.NODE_ENV || 'development',

    // 数据库
    database: {
      host: dbHost,
      port: dbPort,
      name: dbName,
      user: dbUser,
      password: dbPassword,
      url: process.env.DATABASE_URL
        || `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}?schema=public`,
    },

    // Redis
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || '',
    },

    // JWT
    jwt: {
      secret: process.env.JWT_SECRET || 'hermesx_jwt_secret_change_in_production',
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    },

    // 加密密钥 (AES-256-GCM)
    encryptionKey: process.env.ENCRYPTION_KEY || 'hermesx_encryption_key_32bytes_change_me!!',

    // 默认交易环境
    defaultEnvironment: process.env.DEFAULT_ENVIRONMENT || 'TESTNET',

    // 风控默认阈值
    risk: {
      maxPositions: parseInt(process.env.RISK_MAX_POSITIONS || '5', 10),
      maxSingleNotional: parseFloat(process.env.RISK_MAX_SINGLE_NOTIONAL || '1000'),
      maxTotalLossPct: parseFloat(process.env.RISK_MAX_TOTAL_LOSS_PCT || '20'),
      maxConsecutiveLosses: parseInt(process.env.RISK_MAX_CONSECUTIVE_LOSSES || '5', 10),
    },

    // 行情 WebSocket 重连间隔(ms)
    marketWsReconnectInterval: parseInt(
      process.env.MARKET_WS_RECONNECT_INTERVAL || '5000',
      10,
    ),
  };
};

export type AppConfig = ReturnType<typeof configuration>;

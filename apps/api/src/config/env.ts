export const config = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  port: Number.parseInt(process.env.PORT || '3000'),
};

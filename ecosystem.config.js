module.exports = {
  apps: [
    {
      name: 'orderflow',
      script: 'server/index.js',
      instances: 1,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_file: '.env',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
    },
  ],
};

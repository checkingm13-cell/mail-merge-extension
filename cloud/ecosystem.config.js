module.exports = {
  apps: [
    {
      name: 'mail-merge-cloud-runner',
      script: './cloud/start-cloud-chrome.sh',
      interpreter: 'bash',
      max_memory_restart: '1800M',
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        DISPLAY: ':99'
      }
    },
    {
      name: 'mail-merge-web-dashboard',
      script: './cloud/server.js',
      max_memory_restart: '350M',
      restart_delay: 3000,
      autorestart: true,
      env: {
        PORT: 3000,
        NODE_ENV: 'production'
      }
    }
  ]
};

module.exports = {
  apps: [
    {
      name: 'mail-merge-cloud-runner',
      script: './cloud/start-cloud-chrome.sh',
      interpreter: 'bash',
      max_memory_restart: '1500M',
      restart_delay: 5000,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        DISPLAY: ':99'
      }
    }
  ]
};

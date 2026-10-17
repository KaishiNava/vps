const config = {
  brand: {
    name: "Franx Host",
    shortName: "FRANX HOST",
    owner: "kyZX",
    terminalUser: "root",
    hostname: "franx-host"
  },
  // Set these as Railway Variables. Never commit real secrets here.
  auth: {
    username: process.env.ADMIN_USERNAME || "kyZX",
    password: process.env.ADMIN_PASSWORD || "adminkyzx",
    sessionSecret: process.env.SESSION_SECRET || "franxHost_9xK7mP2vR8tY4nQ6wL3zA5sD1fG0hJbC"
  },
  terminal: {
    shell: process.env.SHELL_PATH || "/bin/bash",
    // A dedicated workspace directory. Mount a Railway Volume at /data
    // to persist project files across deployments/restarts.
    workspace: process.env.WORKSPACE_DIR || "/data/projects",
    maxSessionsPerAdmin: 1
  },
  server: {
    port: Number(process.env.PORT || 3000),
    host: "0.0.0.0"
  }
};

export default config;

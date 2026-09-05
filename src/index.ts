import { type ExtensionAPI, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { type Config, resolveConfig } from './config.ts';
import { createSshBashTool } from './tool.ts';

export default function sshExtension(pi: ExtensionAPI) {
  pi.registerFlag('ssh-host', { type: 'string', description: 'Default bash SSH host; "local" keeps execution local' });
  pi.registerFlag('ssh-cwd', { type: 'string', description: 'Default remote absolute working directory' });
  pi.registerFlag('ssh-connect-timeout', { type: 'string', description: 'SSH connection timeout in integer seconds (default 10)' });

  let config: Config | Error = new Error('pi-ssh not initialized');
  const getConfig = () => {
    if (config instanceof Error) throw config;
    return config;
  };
  pi.registerTool(createSshBashTool(getConfig));

  // Extension CLI flags are only available after the factory has returned.
  pi.on('session_start', (_event, ctx) => {
    try {
      config = resolveConfig({
        host: pi.getFlag('ssh-host') as string | undefined,
        cwd: pi.getFlag('ssh-cwd') as string | undefined,
        connectTimeout: pi.getFlag('ssh-connect-timeout') as string | undefined,
      }, process.env);
      const settings = SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
      pi.registerTool(createSshBashTool(getConfig, {
        shellPath: settings.getShellPath(), commandPrefix: settings.getShellCommandPrefix(),
      }));
    } catch (error) {
      config = error instanceof Error ? error : new Error(String(error));
    }
  });

  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\n${config instanceof Error
      ? `pi-ssh bash is blocked: ${config.message}. Ask the user to correct configuration and reload; do not work around this with other tools.`
      : `pi-ssh bash default host: ${JSON.stringify(config.host)}. Omitted host uses this default; host="local" always selects the local machine. Default remote cwd: ${config.cwd === undefined ? 'remote login directory' : JSON.stringify(config.cwd)}. Connection timeout: ${config.connectTimeout}s. Other tools and ! / !! commands remain local. Remote commands need Bash; cwd must be an absolute remote path.`}`,
  }));
}

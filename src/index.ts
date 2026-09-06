import { type ExtensionAPI, type ToolDefinition, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { type Config, resolveConfig } from './config.ts';
import { createSshBashTool } from './tool.ts';
import { createSshFileTools } from './file-tools.ts';

export default function sshExtension(pi: ExtensionAPI) {
  pi.registerFlag('ssh-host', { type: 'string', description: 'Default SSH host for bash and file tools; "local" keeps execution local' });
  pi.registerFlag('ssh-cwd', { type: 'string', description: 'Default remote absolute working directory' });
  pi.registerFlag('ssh-connect-timeout', { type: 'string', description: 'SSH connection timeout in integer seconds (default 10)' });

  let config: Config | Error = new Error('pi-ssh not initialized');
  const getConfig = () => {
    if (config instanceof Error) throw config;
    return config;
  };
  for (const tool of Object.values(createSshFileTools(getConfig))) pi.registerTool(tool as ToolDefinition<any, any, any>);
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
      for (const tool of Object.values(createSshFileTools(getConfig, { autoResizeImages: settings.getImageAutoResize() }))) pi.registerTool(tool as ToolDefinition<any, any, any>);
      pi.registerTool(createSshBashTool(getConfig, {
        shellPath: settings.getShellPath(), commandPrefix: settings.getShellCommandPrefix(),
      }));
    } catch (error) {
      config = error instanceof Error ? error : new Error(String(error));
    }
  });

  pi.on('before_agent_start', event => ({
    systemPrompt: `${event.systemPrompt}\n\n${config instanceof Error
      ? `pi-ssh tools are blocked: ${config.message}. Ask the user to correct configuration and reload; do not work around this with other tools.`
      : `pi-ssh bash/read/write/edit/find/grep/ls default host: ${JSON.stringify(config.host)}. Omitted host uses this default; host="local" always selects the local machine. Default remote cwd: ${config.cwd === undefined ? 'remote login directory' : JSON.stringify(config.cwd)}. Connection timeout: ${config.connectTimeout}s. These seven tools follow this default, including file mutations. Other extension tools and ! / !! commands remain local. Use read with host="local" for bash full-output artifacts, which are always local. Local file paths use the live session cwd; remote relative paths use the remote cwd above, and ~ uses the selected machine’s home. File tools accept host but not per-call cwd. Remote bash needs Bash; its cwd must be absolute. Remote file tools need Python 3.9+, find needs fd/fdfind, and grep needs rg; missing utilities are errors, never local fallbacks.`}`,
  }));
}

import { createBashToolDefinition, type BashToolOptions } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { type Config, resolveTarget } from './config.ts';
import { buildSshCommand } from './ssh.ts';

const local = createBashToolDefinition(process.cwd());
const parameters = Type.Object({
  ...local.parameters.properties,
  host: Type.Optional(Type.String({
    description: 'SSH alias or user@host. Omit to use the configured default (normally local). Use "local" to force local execution, even with a remote default.',
  })),
  cwd: Type.Optional(Type.String({
    description: 'Remote-only absolute POSIX working directory. Omit for the configured remote cwd or remote login directory. For local commands use cd in command.',
  })),
});

export function createSshBashTool(getConfig: () => Config, localOptions?: Pick<BashToolOptions, 'shellPath' | 'commandPrefix'>) {
  const localTool = localOptions ? createBashToolDefinition(process.cwd(), localOptions) : local;
  return {
    ...local,
    parameters,
    description: `${local.description} Set host to an SSH alias or user@host for remote Bash; host="local" always runs locally. Omitted host uses the configured default. Remote cwd is independent of the local project. Full output files are always LOCAL. SSH is non-interactive; configure keys and known_hosts first. read/write/edit/find/grep/ls also accept host. Other extension tools and ! commands remain local; read local output artifacts with host="local".`,
    promptSnippet: 'Execute Bash locally or on an SSH host; host="local" forces local execution',
    promptGuidelines: [
      'Use bash with host for SSH execution rather than embedding ssh in command. bash host="local" explicitly selects this machine.',
      'bash/read/write/edit/find/grep/ls support host and follow the SSH default. Bash full-output files are always local: use read with host="local" to open them. Other extension tools and ! / !! remain local. Local PI_* session variables are not explicitly forwarded remotely.',
    ],
    renderCall(input: Partial<Static<typeof parameters>>, theme: Parameters<NonNullable<typeof local.renderCall>>[1],
      context: Parameters<NonNullable<typeof local.renderCall>>[2]) {
      let annotation = 'Target: unresolved (incomplete arguments or invalid configuration)';
      try {
        const target = resolveTarget(input, getConfig());
        annotation = `Target: ${target.host === 'local' ? 'local' : `SSH ${JSON.stringify(target.host)}`}${input.host === undefined ? ' (current default)' : ''}`;
        if (target.host !== 'local') {
          annotation += `; cwd: ${JSON.stringify(target.cwd ?? 'remote login directory')}${input.cwd === undefined ? ' (current default)' : ''}`;
        }
      } catch { /* Rendering partial arguments must not hide the command or throw. */ }
      // Presentation only: retain pi's wrapping, duration state and result renderer.
      return local.renderCall!({ ...input, command: `# ${annotation}\n${input.command ?? ''}` }, theme, context);
    },
    async execute(id: string, input: Static<typeof parameters>, signal: Parameters<typeof local.execute>[2],
      onUpdate: Parameters<typeof local.execute>[3], ctx: Parameters<typeof local.execute>[4]) {
      const config = getConfig();
      const target = resolveTarget(input, config);
      if (target.host === 'local') return localTool.execute(id, input, signal, onUpdate, ctx);
      const remote = createBashToolDefinition(ctx.cwd, {
        exposeSessionEnvironment: false,
        spawnHook: spawn => ({
          ...spawn,
          command: buildSshCommand(target.host, spawn.command, target.cwd, config.connectTimeout),
        }),
      });
      return remote.execute(id, input, signal, onUpdate, ctx);
    },
  };
}

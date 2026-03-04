import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  passwordHash: z.string(),
  totpSecret: z.string().nullable(),
  role: z.enum(['admin', 'user']),
  createdAt: z.string(),
});

export type User = z.infer<typeof UserSchema>;

export const LoginPayloadSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().length(6).optional(),
});

export type LoginPayload = z.infer<typeof LoginPayloadSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const AgentStatusEnum = z.enum(['starting', 'running', 'paused', 'stopped']);

export type AgentStatus = z.infer<typeof AgentStatusEnum>;

export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: AgentStatusEnum,
  packPath: z.string(),
  model: z.string().nullable(),
  containerId: z.string().nullable(),
  token: z.string(),
  tags: z.array(z.string()).optional().default([]),
  createdAt: z.string(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const CreateAgentPayloadSchema = z.object({
  name: z.string().min(1),
  packPath: z.string().min(1),
  model: z.string().optional(),
  sessionVars: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export type CreateAgentPayload = z.infer<typeof CreateAgentPayloadSchema>;

export const UpdateAgentPayloadSchema = z.object({
  tags: z.array(z.string()).optional(),
  model: z.string().optional(),
});

export type UpdateAgentPayload = z.infer<typeof UpdateAgentPayloadSchema>;

export const AgentPackManifestSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  author: z.string().optional(),
  model: z.string(),
  requiredEnvVars: z.array(z.string()).optional(),
});

export type AgentPackManifest = z.infer<typeof AgentPackManifestSchema>;

export const ApiKeySchema = z.object({
  id: z.string(),
  userId: z.string(),
  keyName: z.string(),
  createdAt: z.string(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

export const PluginSidebarSlotSchema = z.object({
  icon: z.string(),
  label: z.string(),
  route: z.string(),
});

export type PluginSidebarSlot = z.infer<typeof PluginSidebarSlotSchema>;

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'Plugin name must be lowercase alphanumeric with dashes'),
  description: z.string().optional(),
  author: z.string().optional(),
  image: z.string().min(1),
  mcpPort: z
    .number()
    .int()
    .min(1024)
    .max(65535)
    .describe('Non-privileged port (1024-65535) for the MCP server'),
  uiPort: z
    .number()
    .int()
    .min(1024)
    .max(65535)
    .optional()
    .describe('Optional non-privileged port (1024-65535) for the plugin UI'),
  requiredEnvVars: z.array(z.string()).optional().default([]),
  sidebar: PluginSidebarSlotSchema.optional(),
  mountShared: z.boolean().optional().default(false),
  replacesNativeFeatures: z.array(z.string()).optional().default([]),
  generateEnvVars: z.array(z.string()).optional().default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export const PluginStatusEnum = z.enum(['running', 'stopped', 'error']);

export type PluginStatus = z.infer<typeof PluginStatusEnum>;

export const PluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  image: z.string(),
  mcpPort: z.number(),
  uiPort: z.number().nullable(),
  containerName: z.string(),
  status: PluginStatusEnum,
  manifestUrl: z.string(),
  sidebarSlot: PluginSidebarSlotSchema.nullable(),
  createdAt: z.string(),
});

export type Plugin = z.infer<typeof PluginSchema>;

export const InstallPluginPayloadSchema = z.object({
  manifestUrl: z.string().url(),
});

export type InstallPluginPayload = z.infer<typeof InstallPluginPayloadSchema>;

export const ChannelTypeEnum = z.enum(['telegram']);
export type ChannelType = z.infer<typeof ChannelTypeEnum>;

export const ChannelStatusEnum = z.enum(['running', 'stopped', 'error']);
export type ChannelStatus = z.infer<typeof ChannelStatusEnum>;

export const DeployChannelPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('telegram'),
    botToken: z.string().min(1),
    allowedUsers: z.string().optional(),
    notificationUserId: z.string().optional(),
  }),
]);
export type DeployChannelPayload = z.infer<typeof DeployChannelPayloadSchema>;

export const ChannelSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  type: ChannelTypeEnum,
  image: z.string(),
  containerName: z.string(),
  status: ChannelStatusEnum,
  envVars: z.record(z.string()).nullable(),
  createdAt: z.string(),
});
export type Channel = z.infer<typeof ChannelSchema>;

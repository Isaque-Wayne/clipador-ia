// Contracts only. No implementation, network call, avatar or voice synthesis is enabled.
export interface ProviderAsset { id: string; path: string; checksum: string; license: string }
export interface GeneratedImageProvider { generate(input: { prompt: string; width: number; height: number }, signal: AbortSignal): Promise<ProviderAsset> }
export interface GeneratedVideoProvider { generate(input: { prompt: string; duration: number }, signal: AbortSignal): Promise<ProviderAsset> }
export interface AvatarProvider { render(input: { approvedAvatarId: string; script: string }, signal: AbortSignal): Promise<ProviderAsset> }
export interface VoiceProvider { synthesize(input: { approvedVoiceId: string; text: string }, signal: AbortSignal): Promise<ProviderAsset> }

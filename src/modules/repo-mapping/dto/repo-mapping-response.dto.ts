import type { repoMappings } from '@db/schema';

export type RepoMappingResponse = typeof repoMappings.$inferSelect;

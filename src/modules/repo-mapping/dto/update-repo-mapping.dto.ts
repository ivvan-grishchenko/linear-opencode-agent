import { z } from 'zod';

export const UpdateRepoMappingSchema = z.object({
	repositoryName: z.string(),
});

export type UpdateRepoMappingDto = z.infer<typeof UpdateRepoMappingSchema>;

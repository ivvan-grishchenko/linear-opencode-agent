import { z } from 'zod';

export const CreateRepoMappingSchema = z.object({
	organizationId: z.string(),
	projectId: z.string(),
	repositoryName: z.string(),
});

export type CreateRepoMappingDto = z.infer<typeof CreateRepoMappingSchema>;

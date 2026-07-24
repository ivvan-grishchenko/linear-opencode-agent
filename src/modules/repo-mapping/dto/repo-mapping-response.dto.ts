import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const repoMappingResponseSchema = z.object({
	createdAt: z.number().int(),
	organizationId: z.string(),
	projectId: z.string(),
	repositoryName: z.string(),
	updatedAt: z.number().int(),
});

export class RepoMappingResponseDto extends createZodDto(repoMappingResponseSchema) {}

export type RepoMappingResponse = z.infer<typeof repoMappingResponseSchema>;

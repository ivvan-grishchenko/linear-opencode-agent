import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createRepoMappingSchema = z.object({
	organizationId: z.string(),
	projectId: z.string(),
	repositoryName: z.string(),
});

export class CreateRepoMappingDto extends createZodDto(createRepoMappingSchema) {}

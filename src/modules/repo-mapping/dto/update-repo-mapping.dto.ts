import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const updateRepoMappingSchema = z.object({
	repositoryName: z.string(),
});

export class UpdateRepoMappingDto extends createZodDto(updateRepoMappingSchema) {}

export type UpdateRepoMapping = z.infer<typeof updateRepoMappingSchema>;

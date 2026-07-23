import type { CreateRepoMappingDto, RepoMappingResponse, UpdateRepoMappingDto } from '../dto';

export interface IRepoMappingService {
	create(input: CreateRepoMappingDto): Promise<RepoMappingResponse>;
	delete(organizationId: string, projectId: string): Promise<void>;
	findByOrganizationAndProject(
		organizationId: string,
		projectId: string
	): Promise<RepoMappingResponse | null>;
	list(organizationId?: string): Promise<RepoMappingResponse[]>;
	update(
		organizationId: string,
		projectId: string,
		input: UpdateRepoMappingDto
	): Promise<RepoMappingResponse>;
}
